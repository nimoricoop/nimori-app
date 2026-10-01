#!/usr/bin/env python3
"""Mutation testing for the oracle, the price guards and the mover rule.

Each mutant is a single deliberate defect. It is applied to the source, the lobby/hook suites run, and the mutant
is KILLED if at least one test fails. The source is always restored and the cached invariant failures are always
purged afterwards (foundry replays a cached failure against healthy code otherwise).

Usage (from contracts/): python3 test/mutation/mutate.py [label-substring]
"""
import os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
H, L = "src/NimoriHook.sol", "src/NimoriLobby.sol"

MUTANTS = [
    # ---- oracle
    ("O1 cumulative sign flipped", H, "last.tickCumulative + int56(tick) *", "last.tickCumulative - int56(tick) *"),
    ("O2 mean divided by the requested window, not the real one", H, "meanTick = int24(delta / w);", "meanTick = int24(delta / int56(uint56(secondsAgo)));"),
    ("O3 no rounding toward -inf", H, "if (delta < 0 && (delta % w != 0)) meanTick--;", ""),
    ("O4 search returns the newest entry", H, "return obs[(oldest + lo) % CARDINALITY];", "return obs[st.index];"),
    ("O5 history check removed", H, "if (first.timestamp > target) revert NotEnoughHistory();", ""),
    ("O6 no extrapolation since the last write", H, "int56(spot) * int56(uint56(nowTs - head.timestamp))", "int56(spot) * int56(0)"),
    ("O7 ring advances every write (no spacing)", H, "if (last.timestamp - prev.timestamp >= SPACING)", "if (true)"),
    ("O8 credits the tick AFTER the swap (reads slot0 post-swap via a stale tick of 0)", H, "(, int24 tick,,) = poolManager.getSlot0(id);", "int24 tick = 0;"),
    ("O9 search boundary off by one (strict <)", H, "if (obs[(oldest + mid) % CARDINALITY].timestamp <= target) lo = mid;", "if (obs[(oldest + mid) % CARDINALITY].timestamp < target) lo = mid;"),
    # ---- guards
    ("G11 match accepts a missing reference", L, "if (!ok || !ru) revert PriceGuard", "if (!ok) revert PriceGuard"),
    ("G1 TWAP deviation never fails", L, "if (_absDiff(spot, t) > uint24(maxDeviationTicks)) ok = false;", ""),
    ("G2 reference deviation never fails", L, "if (_absDiff(spot, ref) > uint24(maxRefDeviationTicks)) ok = false;", ""),
    ("G3 reference orientation ignored", L, "ref = referenceInverted ? -r : r;", "ref = r;"),
    ("G4 TWAP bound off by one (>=)", L, "if (_absDiff(spot, t) > uint24(maxDeviationTicks)) ok = false;", "if (_absDiff(spot, t) >= uint24(maxDeviationTicks)) ok = false;"),
    ("G5 'no guard available' accepted", L, "if (!twapUsed && !refUsed) ok = false;", ""),
    ("G6 unplug skips the exit guard", L, "        } else {\n            _requireExitPrice();\n        }", "        }"),
    ("G7 matchQueue skips the guard", L, "        if (difficulty > HARD) revert BadDifficulty();\n        _requirePrice();", "        if (difficulty > HARD) revert BadDifficulty();"),
    ("G8 auto-match ignores the guard", L, "        if (!ok || !refUsed) return;", "        ok; refUsed;"),
    ("G9 dead reference still used", L, "if (referenceSet && poolManager.getLiquidity(referenceId) > 0) {", "if (referenceSet) {"),
    ("G10 absDiff loses the sign (one-sided guard)", L, "return uint24(uint256(d < 0 ? -d : d));", "return d < 0 ? 0 : uint24(uint256(d));"),
    # ---- exit guard and escape hatch
    ("X1 exit band off by one (<)", L, "ok = _absDiff(spot, t) <= uint24(maxExitDeviationTicks);", "ok = _absDiff(spot, t) < uint24(maxExitDeviationTicks);"),
    ("X2 exit uses the narrow match band", L, "ok = _absDiff(spot, t) <= uint24(maxExitDeviationTicks);", "ok = _absDiff(spot, t) <= uint24(maxDeviationTicks);"),
    ("X3 exit guard always passes", L, "ok = _absDiff(spot, t) <= uint24(maxExitDeviationTicks);", "ok = true;"),
    ("X4 exit also requires the Pons reference", L, "        } else {\n            _requireExitPrice();", "        } else {\n            _requirePrice();"),
    ("E1 escape skips the delay", L, "if (req != 0 && block.timestamp >= req + UNPLUG_DELAY) {", "if (req != 0) {"),
    ("E2 escape never opens", L, "if (req != 0 && block.timestamp >= req + UNPLUG_DELAY) {", "if (req == 1) {"),
    ("E3 escape delay off by one (>)", L, "if (req != 0 && block.timestamp >= req + UNPLUG_DELAY) {", "if (req != 0 && block.timestamp > req + UNPLUG_DELAY) {"),
    ("E4 request allowed while the guard passes", L, "        if (ok) revert GuardPasses();\n", ""),
    ("E5 request repeatable (clock reset)", L, "        if (unplugRequestedAt[sid] != 0) revert AlreadyRequested();\n", ""),
    ("E6 request by anyone", L, "        if (ownerOf(seatId) != msg.sender) revert NotSeatOwner();\n        uint256 sid = seatId / 2;\n        if (!sessions[sid].open) revert SessionClosed();\n        if (unplugRequestedAt", "        uint256 sid = seatId / 2;\n        if (!sessions[sid].open) revert SessionClosed();\n        if (unplugRequestedAt"),
    ("E7 request on a closed session", L, "        if (!sessions[sid].open) revert SessionClosed();\n        if (unplugRequestedAt", "        if (unplugRequestedAt"),
    # ---- mover rule, settlement, fees
    ("M1 NIMORI rose: 1P also takes the NIMORI", L, "            eth2 = a - e0;\n            nim2 = b;", "            eth2 = a - e0;\n            nim1 = b;"),
    ("M2 ETH rose: 2P cap removed", L, "nim2 = b < n0 ? b : n0;", "nim2 = n0;"),
    ("M3 ETH rose: 1P loses the surplus NIMORI", L, "nim1 = b - nim2;", "nim1 = 0;"),
    ("M4 mover test inverted", L, "if (a >= e0) {", "if (a < e0) {"),
    ("M5 1P rage-quit penalty not paid to partner", L, "                eth2 += pe;\n                nim2 += pn;", "                eth1 += pe;\n                nim1 += pn;"),
    ("M6 rage-quit window inclusive", L, "bool rage = block.timestamp < uint256(s.start) + MIN_SESSION;", "bool rage = block.timestamp <= uint256(s.start) + MIN_SESSION;"),
    ("M7 principal not net of fees", L, "return abi.encode(got0 - fee0, got1 - fee1, fee0, fee1);", "return abi.encode(got0, got1, fee0, fee1);"),
    ("M8 protocol fee skipped", L, "uint256 p0 = (f0 * PROTOCOL_FEE_BPS) / BPS;", "uint256 p0 = 0;"),
    ("M9 fee split all to 2P", L, "uint256 half0 = r0 / 2;", "uint256 half0 = 0;"),
]

TESTS = ["--match-path", "test/Nimori{Hook,Lobby,LobbyGuards,LobbyInvariant}.t.sol"]


def purge():
    shutil.rmtree(os.path.join(ROOT, "cache", "invariant"), ignore_errors=True)


def run():
    r = subprocess.run(["forge", "test", *TESTS], capture_output=True, text=True)
    out = r.stdout + r.stderr
    failed = [l for l in out.splitlines() if l.startswith("[FAIL")]
    compile_err = "Compiler run failed" in out or "Error (" in out
    return r.returncode, failed, compile_err


def main():
    flt = sys.argv[1] if len(sys.argv) > 1 else ""
    killed, total, survivors = 0, 0, []
    for label, path, old, new in MUTANTS:
        if flt and flt not in label:
            continue
        src = open(path).read()
        assert src.count(old) == 1, f"{label}: anchor found {src.count(old)} times"
        total += 1
        try:
            open(path, "w").write(src.replace(old, new))
            purge()
            code, failed, cerr = run()
        finally:
            open(path, "w").write(src)
            purge()
        if cerr:
            print(f"  COMPILE-ERROR {label}")
            survivors.append(label + " (did not compile)")
        elif code != 0 and failed:
            killed += 1
            print(f"  KILLED   {label}  <- {len(failed)} failing, e.g. {failed[0][:110]}")
        else:
            survivors.append(label)
            print(f"  SURVIVED {label}")
    print(f"\nmutation score: {killed}/{total}")
    for s in survivors:
        print("  survivor:", s)
    code, failed, _ = run()
    print("healthy code after restore:", "PASS" if code == 0 else f"FAIL {failed}")


if __name__ == "__main__":
    main()
