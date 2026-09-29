/* Local dev: serves the static site and runs api/*.js like Vercel would (req.body parsed, res.status().json()). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const port = Number(process.env.PORT || 8791);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const file = path.join(root, url.pathname + '.js');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('no route'); }
    let raw = '';
    for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
    res.status = (s) => { res.statusCode = s; return res; };
    res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    // reload every api module (routes and their shared helpers) so edits show up without a restart
    Object.keys(require.cache).filter((k) => k.startsWith(path.join(root, 'api'))).forEach((k) => delete require.cache[k]);
    return require(file)(req, res);
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log('nimori dev on http://localhost:' + port));
