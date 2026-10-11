import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { createApi } from './api.mjs';

const HOST = '127.0.0.1';
const PORT = 5173;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const api = createApi(openStore(join(root, 'data', 'nor-tutor.db')), `http://${HOST}:${PORT}`);

createServer(async (req, res) => {
  let file;
  try {
    const rawPath = new URL(req.url, 'http://localhost').pathname;
    if (rawPath.startsWith('/api/')) return await api(req, res, rawPath);
    const path = decodeURIComponent(rawPath);
    if (path.split('/').some((s) => s.startsWith('.'))) {
      res.writeHead(404).end('Not found');
      return;
    }
    file = resolve(join(root, normalize(path === '/' ? '/index.html' : path)));
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  // Only known asset types are served: keeps data/nor-tutor.db and its journal files private.
  const type = types[extname(file).toLowerCase()];
  if (!type) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': type }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, HOST, () => console.log(`http://${HOST}:${PORT}`));
