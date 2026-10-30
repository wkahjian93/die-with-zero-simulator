// Tiny static server for testing on this computer.
// node serve.js       -> the game as the artifact sees it (port 5186)
// node serve.js docs  -> the built phone app from build.js (port 5187)
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = process.argv[2] === 'docs';
const root = app ? path.join(__dirname, 'docs') : __dirname;
const port = app ? 5187 : 5186;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    let body = data;
    // Local test only: the published artifact gets its own document skeleton.
    if (!app && path.extname(file) === '.html') body = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + data + '</body></html>';
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
}).listen(port, () => console.log('Die With Zero Simulator running at http://localhost:' + port));
