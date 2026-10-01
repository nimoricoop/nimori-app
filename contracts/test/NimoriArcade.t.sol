// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {NimoriArcade} from "../src/NimoriArcade.sol";

contract MockToken is ERC20 {
    constructor() ERC20("NIMORI", "NIMORI") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Takes 1% on every transfer, to prove the Arcade credits what actually arrives.
contract TaxedToken is ERC20 {
    constructor() ERC20("TAXED", "TAX") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

contract EthRefuser {
    function stakeVia(NimoriArcade a, MockToken t, uint256 amt) external {
        t.approve(address(a), amt);
        a.stake(amt);
    }

    function claimVia(NimoriArcade a) external {
        a.claim();
    }

    function claimToVia(NimoriArcade a, address to) external {
        a.claimTo(to);
    }
}

contract Reenterer {
    NimoriArcade public a;
    bool public tried;
    bool public reentered;

    constructor(NimoriArcade a_) {
        a = a_;
    }

    function stakeVia(MockToken t, uint256 amt) external {
        t.approve(address(a), amt);
        a.stake(amt);
    }

    function claimVia() external {
        a.claim();
    }

    receive() external payable {
        if (!tried) {
            tried = true;
            try a.claim() {
                reentered = true;
            } catch {}
        }
    }
}

contract NimoriArcadeTest is Test {
    NimoriArcade arcade;
    MockToken token;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address feeder = makeAddr("feeder");

    function setUp() public {
        arcade = new NimoriArcade(owner);
        token = new MockToken();
        token.mint(alice, 1_000_000e18);
        token.mint(bob, 1_000_000e18);
        vm.deal(feeder, 1_000 ether);
        vm.prank(alice);
        token.approve(address(arcade), type(uint256).max);
        vm.prank(bob);
        token.approve(address(arcade), type(uint256).max);
    }

    function _setToken() internal {
        vm.prank(owner);
        arcade.setStakingToken(address(token));
    }

    function _feed(uint256 amount) internal {
        vm.prank(feeder);
        (bool ok,) = address(arcade).call{value: amount}("");
        assertTrue(ok);
    }

    // ------------------------------------------------------------ token setup

    function test_deploysWithoutToken_stakeAndKickRevert() public {
        assertEq(address(arcade.stakingToken()), address(0));
        vm.prank(alice);
        vm.expectRevert(NimoriArcade.TokenNotSet.selector);
        arcade.stake(1e18);
        _feed(1 ether);
        vm.expectRevert(NimoriArcade.TokenNotSet.selector);
        arcade.kick();
        assertEq(arcade.queuedRewards(), 1 ether);
    }

    function test_setStakingToken_onlyOwner_contractOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        arcade.setStakingToken(address(token));
        vm.prank(owner);
        vm.expectRevert(NimoriArcade.NotAContract.selector);
        arcade.setStakingToken(makeAddr("eoa"));
        _setToken();
        assertEq(address(arcade.stakingToken()), address(token));
    }

    function test_tokenChangeableUntilFirstStake_thenLocked() public {
        _setToken();
        MockToken other = new MockToken();
        vm.prank(owner);
        arcade.setStakingToken(address(other));
        _setToken();
        vm.prank(alice);
        arcade.stake(1e18);
        assertTrue(arcade.tokenLocked());
        vm.prank(owner);
        vm.expectRevert(NimoriArcade.TokenIsLocked.selector);
        arcade.setStakingToken(address(other));
    }

    // ------------------------------------------------------------ streaming

    function test_singleStaker_getsWholeStream() public {
        _setToken();
        vm.prank(alice);
        arcade.stake(100e18);
        _feed(7 ether);
        arcade.kick();
        vm.warp(block.timestamp + 7 days);
        uint256 before = alice.balance;
        vm.prank(alice);
        arcade.claim();
        assertApproxEqAbs(alice.balance - before, 7 ether, 1e6);
    }

    function test_twoStakers_proRata() public {
        _setToken();
        vm.prank(alice);
        arcade.stake(100e18);
        vm.prank(bob);
        arcade.stake(300e18);
        _feed(4 ether);
        arcade.kick();
        vm.warp(block.timestamp + 8 days);
        assertApproxEqAbs(arcade.earned(alice), 1 ether, 1e6);
        assertApproxEqAbs(arcade.earned(bob), 3 ether, 1e6);
    }

    function test_lateStake_cannotSnipeDeposit() public {
        _setToken();
        vm.prank(alice);
        arcade.stake(100e18);
        _feed(7 ether);
        arcade.kick();
        uint256 start = block.timestamp;
        // Bob stakes a huge amount on the last day only.
        vm.warp(start + 6 days);
        vm.prank(bob);
        arcade.stake(100_000e18);
        vm.warp(start + 7 days);
        // Bob gets ~1 day of rewards at most, not the whole deposit.
        assertLt(arcade.earned(bob), 1 ether + 1e6);
        assertGt(arcade.earned(alice), 6 ether - 1e6);
    }

    function test_kick_permissionlessOnlyAfterPeriod() public {
        _setToken();
        vm.prank(alice);
        arcade.stake(1e18);
        _feed(1 ether);
        arcade.kick();
        _feed(1 ether);
        vm.prank(bob);
        vm.expectRevert(NimoriArcade.PeriodActive.selector);
        arcade.kick();
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        arcade.kick();
    }

    function test_ownerKickMidPeriod_rollsLeftover() public {
        _setToken();
        vm.prank(alice);
        arcade.stake(1e18);
        _feed(7 ether);
        arcade.kick();
        vm.warp(block.timestamp + 3.5 days);
        _feed(1 ether);
        vm.prank(owner);
        arcade.kick();
        assertApproxEqAbs(arcade.remainingInPeriod(), 4.5 ether, 1e6);
        vm.warp(block.timestamp + 7 days);
        assertApproxEqAbs(arcade.earned(alice), 8 ether, 1e6);
    }

    function test_kickWithNothingQueued_reverts() public {
        _setToken();
        vm.expectRevert(NimoriArcade.NothingQueued.selector);
        arcade.kick();
    }

    function test_streamWithNoStakers_returnsToQueue() public {
        _setToken();
        _feed(7 ether);
        arcade.kick();
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        arcade.stake(1e18);
        // two days streamed to nobody went back to the queue
        assertApproxEqAbs(arcade.queuedRewards(), 2 ether, 1e6);
        vm.warp(block.timestamp + 5 days);
        assertApproxEqAbs(arcade.earned(alice), 5 ether, 1e6);
    }

    // ------------------------------------------------------------ withdraw / claim

    function test_withdrawAlwaysWorks_evenMidPeriod() public {
        _setToken();
        vm.prank(alice);
        arcade.stake(100e18);
        _feed(7 ether);
        arcade.kick();
        vm.warp(block.timestamp + 1 days);
        uint256 bal = token.balanceOf(alice);
        vm.prank(alice);
        arcade.exit();
        assertEq(token.balanceOf(alice) - bal, 100e18);
        assertEq(arcade.balanceOf(alice), 0);
        assertApproxEqAbs(alice.balance, 1 ether, 1e6);
    }

    function test_cannotWithdrawMoreThanStaked() public {
        _setToken();
        vm.prank(alice);
        arcade.stake(1e18);
        vm.prank(alice);
        vm.expectRevert();
        arcade.withdraw(2e18);
    }

    function test_claimTo_forContractsThatRefuseEth() public {
        _setToken();
        EthRefuser r = new EthRefuser();
        token.mint(address(r), 10e18);
        r.stakeVia(arcade, token, 10e18);
        _feed(1 ether);
        arcade.kick();
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(NimoriArcade.EthTransferFailed.selector);
        r.claimVia(arcade);
        r.claimToVia(arcade, bob);
        assertApproxEqAbs(bob.balance, 1 ether, 1e6);
    }

    function test_reentrancyOnClaim_blocked() public {
        _setToken();
        Reenterer r = new Reenterer(arcade);
        token.mint(address(r), 10e18);
        r.stakeVia(token, 10e18);
        _feed(1 ether);
        arcade.kick();
        vm.warp(block.timestamp + 7 days);
        r.claimVia();
        assertTrue(r.tried());
        assertFalse(r.reentered());
        assertApproxEqAbs(address(r).balance, 1 ether, 1e6);
    }

    function test_taxedToken_creditsReceivedAmount() public {
        TaxedToken t = new TaxedToken();
        t.mint(alice, 100e18);
        vm.prank(owner);
        arcade.setStakingToken(address(t));
        vm.startPrank(alice);
        t.approve(address(arcade), type(uint256).max);
        arcade.stake(100e18);
        vm.stopPrank();
        assertEq(arcade.balanceOf(alice), 99e18);
        assertEq(arcade.totalSupply(), t.balanceOf(address(arcade)));
    }

    // ------------------------------------------------------------ owner limits

    function test_rescueQueued_onlyWhenNoStakers_neverOwedEth() public {
        _setToken();
        _feed(3 ether);
        // nobody staked yet: queued ETH can be rescued
        vm.prank(owner);
        arcade.rescueQueued(payable(owner));
        assertEq(owner.balance, 3 ether);

        vm.prank(alice);
        arcade.stake(1e18);
        _feed(1 ether);
        arcade.kick();
        vm.warp(block.timestamp + 7 days);
        vm.prank(owner);
        vm.expectRevert(NimoriArcade.StakersPresent.selector);
        arcade.rescueQueued(payable(owner));

        // alice leaves WITHOUT claiming: her ETH is owed, not queued, and stays for her
        vm.prank(alice);
        arcade.withdraw(1e18);
        _feed(2 ether);
        vm.prank(owner);
        arcade.rescueQueued(payable(owner));
        assertEq(owner.balance, 5 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        arcade.claim();
        assertApproxEqAbs(alice.balance - before, 1 ether, 1e6);
    }

    function test_rescueQueued_blockedDuringPeriod() public {
        _setToken();
        _feed(1 ether);
        arcade.kick();
        _feed(1 ether);
        vm.prank(owner);
        vm.expectRevert(NimoriArcade.PeriodActive.selector);
        arcade.rescueQueued(payable(owner));
    }

    function test_recoverERC20_neverStakingToken() public {
        _setToken();
        vm.prank(alice);
        arcade.stake(5e18);
        vm.prank(owner);
        vm.expectRevert(NimoriArcade.CannotRecoverStakingToken.selector);
        arcade.recoverERC20(address(token), owner, 5e18);

        MockToken stray = new MockToken();
        stray.mint(address(arcade), 7e18);
        vm.prank(owner);
        arcade.recoverERC20(address(stray), owner, 7e18);
        assertEq(stray.balanceOf(owner), 7e18);
    }

    function test_setRewardsDuration_bounds() public {
        vm.startPrank(owner);
        vm.expectRevert(NimoriArcade.BadDuration.selector);
        arcade.setRewardsDuration(1 hours);
        vm.expectRevert(NimoriArcade.BadDuration.selector);
        arcade.setRewardsDuration(31 days);
        arcade.setRewardsDuration(3 days);
        vm.stopPrank();
        assertEq(arcade.rewardsDuration(), 3 days);
    }

    function test_ownershipTransferIsTwoStep() public {
        vm.prank(owner);
        arcade.transferOwnership(bob);
        assertEq(arcade.owner(), owner);
        vm.prank(bob);
        arcade.acceptOwnership();
        assertEq(arcade.owner(), bob);
    }

    // ------------------------------------------------------------ fuzz: solvency

    function testFuzz_solvent(uint96 a, uint96 b, uint96 eth1, uint96 eth2, uint32 t1, uint32 t2) public {
        uint256 sa = bound(a, 1, 1_000_000e18);
        uint256 sb = bound(b, 1, 1_000_000e18);
        uint256 e1 = bound(eth1, 1, 500 ether);
        uint256 e2 = bound(eth2, 1, 400 ether);
        _setToken();
        vm.prank(alice);
        arcade.stake(sa);
        _feed(e1);
        arcade.kick();
        vm.warp(block.timestamp + bound(t1, 0, 10 days));
        vm.prank(bob);
        arcade.stake(sb);
        _feed(e2);
        vm.prank(owner);
        arcade.kick();
        vm.warp(block.timestamp + bound(t2, 0, 20 days));
        vm.prank(alice);
        arcade.exit();
        vm.prank(bob);
        arcade.exit();
        // everything paid out or still queued/streaming, never more than came in
        assertLe(alice.balance + bob.balance, e1 + e2);
        assertGe(
            address(arcade).balance, arcade.queuedRewards() + arcade.remainingInPeriod()
        );
    }
}
