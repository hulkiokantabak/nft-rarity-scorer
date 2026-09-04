import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const publicFiles = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ...['boot', 'app', 'core', 'api', 'artblocks', 'config', 'storage'].map(n => [`/${n}.js`, [`${n}.js`, 'text/javascript']]), ...['styles', 'accessibility'].map(n => [`/${n}.css`, [`${n}.css`, 'text/css']])]);
const server = createServer(async (req, res) => {
  const file = publicFiles.get(new URL(req.url, 'http://localhost').pathname);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try { const body = await readFile(new URL('../' + file[0], import.meta.url)); res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }
  catch { res.writeHead(500); res.end('Unable to read static file'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:4173'));
