/**
 * 零依赖静态服务器，用于本地开发。
 * 之所以不用 `python -m http.server`：Python 3.7 在中文主机名下会因
 * socket.getfqdn() 的 UnicodeDecodeError 直接崩溃，且 --bind 无法规避。
 *
 * 用法：node dev-server.mjs [port]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { exec } from 'node:child_process';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());
const PORT = Number(process.argv[2] || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = createServer((req, res) => {
  let pathname;
  try {
    const raw = new URL(req.url, 'http://localhost').pathname;
    try {
      pathname = decodeURIComponent(raw);
    } catch (e) {
      // 非法百分号编码时退回原始路径，交给后面的存在性检查，别直接 400
      pathname = raw;
    }
  } catch (e) {
    send(res, 400, '400 Bad Request');
    return;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  let filePath = resolve(join(ROOT, pathname));
  // 防目录穿越
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    send(res, 403, '403 Forbidden');
    return;
  }

  let stat;
  try {
    stat = statSync(filePath);
    if (stat.isDirectory()) {
      filePath = join(filePath, 'index.html');
      stat = statSync(filePath);
    }
  } catch (e) {
    send(res, 404, `404 Not Found: ${pathname}`);
    return;
  }

  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    // 开发期禁用缓存，改完刷新即生效，不需要 Ctrl+Shift+R
    'Cache-Control': 'no-store, must-revalidate',
  });
  createReadStream(filePath).pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  [错误] 端口 ${PORT} 已被占用。`);
    console.error(`  换个端口：把 dev.bat 里的 PORT 改成 8080，或手动执行 node dev-server.mjs 8080\n`);
  } else {
    console.error('\n  [错误]', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  本地服务器已启动: ${url}`);
  console.log(`  根目录: ${ROOT}`);
  console.log(`  关闭本窗口即停止服务。\n`);

  // 服务真正就绪后再开浏览器，避免抢跑导致「无法访问此网站」
  if (process.argv.includes('--open')) {
    const opener =
      process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    exec(opener, () => {});
  }
});
