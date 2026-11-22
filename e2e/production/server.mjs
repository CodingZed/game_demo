import http from 'node:http';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';

const PREFIX = '/game_demo/';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Serve a temporary production fixture at a GitHub Pages style project path. */
export async function createFixtureServer({ distDir }) {
  const root = await realpath(distDir);
  const requests = [];
  const faults = new Map();
  const sockets = new Set();
  let closePromise;

  const insideRoot = file => file === root || file.startsWith(root + path.sep);
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://fixture.invalid');
    } catch {
      url = { pathname: req.url || '/', search: '' };
    }
    const record = { method: req.method, path: url.pathname, status: 0 };
    requests.push(record);
    const send = (status, body = '', headers = {}) => {
      const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      record.status = status;
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': payload.length,
        ...headers,
      });
      res.end(req.method === 'HEAD' ? undefined : payload);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }

    const injected = faults.get(url.pathname);
    if (injected !== undefined) {
      const fault = typeof injected === 'number' ? { status: injected } : injected;
      send(fault.status ?? 500, fault.body ?? 'Injected fixture failure', fault.headers);
      return;
    }

    if (url.pathname === '/game_demo') {
      send(308, '', { Location: PREFIX + url.search });
      return;
    }
    if (!url.pathname.startsWith(PREFIX)) {
      send(404, 'Not found');
      return;
    }

    let relative;
    try {
      relative = decodeURIComponent(url.pathname.slice(PREFIX.length));
      if (relative.includes('\0') || relative.includes('\\')) throw new Error('Invalid path');
    } catch {
      send(400, 'Invalid path');
      return;
    }
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const filename = path.resolve(root, relative);
    if (!insideRoot(filename)) {
      send(403, 'Outside fixture');
      return;
    }
    try {
      const resolved = await realpath(filename);
      if (!insideRoot(resolved)) {
        send(403, 'Outside fixture');
        return;
      }
      const body = await readFile(resolved);
      send(200, body, { 'Content-Type': MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream' });
    } catch (error) {
      send(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500, 'Unable to serve fixture');
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    projectUrl: origin + PREFIX,
    requests,
    faults,
    /** Accept either (path, status, body) or (path, {status, body, headers}). */
    setFault(requestPath, status = 500, body = 'Injected fixture failure') {
      const pathname = new URL(requestPath, origin).pathname;
      faults.set(pathname, typeof status === 'object' ? status : { status, body });
    },
    /** Closing destroys only sockets owned by this fixture server. */
    close() {
      if (!closePromise) {
        closePromise = new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          server.closeIdleConnections?.();
          server.closeAllConnections?.();
          for (const socket of sockets) socket.destroy();
        });
      }
      return closePromise;
    },
  };
}
