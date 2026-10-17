'use strict';
// Azure 的靜態檔案入口。不使用外部套件，也不公開 repo、部署設定或憑證。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const publicFiles = new Set(require('./hosting/public-files.json'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
let release = { version: 'local' };
try { release = JSON.parse(fs.readFileSync(path.join(__dirname, 'hosting/release.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end(); return; }
    if (pathname === '/healthz') {
      const body = JSON.stringify({ status: 'ok', app: 'andrew1', version: release.version });
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!publicFiles.has(relative)) { response.writeHead(404); response.end(); return; }
    const file = path.join(__dirname, relative);
    try {
      const stat = await fs.promises.stat(file);
      response.setHeader('Content-Type', mime[path.extname(file)]);
      response.setHeader('Accept-Ranges', 'bytes');
      let start = 0;
      let end = stat.size - 1;
      let status = 200;
      // 音效可接受瀏覽器的 Range 要求，支援定位及重新播放。
      if (request.headers.range && request.method === 'GET') {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        }
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
          response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return;
        }
        status = 206;
        response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      }
      response.setHeader('Content-Length', end - start + 1);
      response.writeHead(status);
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(file, { start, end });
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end();
    }
  });
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT || 8080);
  server.listen(port, '0.0.0.0', () => console.log(`Andrew1 listening on port ${port}`));
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10000).unref(); });
}
module.exports = { createServer };
