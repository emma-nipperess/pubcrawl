// Local stand-in for GitHub Pages used by the E2E tests: serves dist/ under a
// repository sub-path, and — like Pages — answers unknown paths with 404.html
// and a 404 status. Listens on loopback only.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist');
const base = (process.env.BASE_PATH || '/pub-crawl/').replace(/\/?$/, '/');
const port = Number(process.env.PORT || 4321);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (!p.startsWith(base)) {
    res.writeHead(404).end('not found');
    return;
  }
  p = normalize(p.slice(base.length)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, p);
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    const body = await readFile(join(root, '404.html'));
    res.writeHead(404, { 'content-type': 'text/html' }).end(body);
  }
}).listen(port, '127.0.0.1', () => console.log(`pages-server on http://127.0.0.1:${port}${base}`));
