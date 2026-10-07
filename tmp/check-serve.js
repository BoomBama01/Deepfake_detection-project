const http = require('http');
const fs = require('fs');
const p = require('path');
const r = '/home/daytona/codebase/dist';
const i = '/home/daytona/codebase/dist/index.html';
const a = /^\/assets\//;
const m = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};
const server = http.createServer((req, res) => {
  const u = req.url || '/';
  const decoded = decodeURIComponent(u);
  let f = p.resolve(r, decoded === '/' ? 'index.html' : decoded);
  if (!f.startsWith(r)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const idx = f === i || decoded === '/';
  const h = idx
    ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
    : a.test(decoded)
      ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
      : {};
  if (a.test(decoded) && !fs.existsSync(f)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  fs.stat(f, (e, s) => {
    if (e || !s.isFile()) {
      if (!a.test(decoded)) {
        fs.readFile(i, (e, d) => {
          res.writeHead(e ? 500 : 200, {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Content-Type': 'text/html',
          });
          res.end(e ? 'Internal server error' : d);
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }
    fs.readFile(f, (e, d) => {
      res.writeHead(200, {
        ...h,
        'Content-Type': m[p.extname(f).toLowerCase()] || 'application/octet-stream',
      });
      res.end(e ? 'Internal server error' : d);
    });
  });
});
server.listen(3000, () => {
  console.log('ready');
  let done = 0;
  const check = (path, wantStatus, wantCache) => {
    http.get(`http://localhost:3000${encodeURI(path)}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const status = res.statusCode;
        const cc = res.headers['cache-control'];
        const okStatus = status === wantStatus;
        const okCache = cc === wantCache;
        console.log(
          `${path} status=${status} (want ${wantStatus}) cache=${cc || '(none)'} (want ${wantCache || '(none)'}) ${okStatus && okCache ? 'OK' : 'FAIL'}`,
        );
        done++;
        if (done === 3) {
          server.close();
          process.exit(okStatus && okCache ? 0 : 1);
        }
      });
    });
  };
  check('/', 200, 'no-cache, no-store, must-revalidate');
  check('/assets/Results-d2f1-VCm.js', 200, 'public, max-age=31536000, immutable');
  check('/assets/does-not-exist.js', 404, undefined);
});
