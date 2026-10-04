import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const root = import.meta.dirname;
const port = Number(process.env.FIXTURE_PORT ?? 47611);

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const name = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
  const type = TYPES[path.extname(name)];
  if (!type) {
    response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"missing"}');
    return;
  }
  readFile(path.join(root, name)).then(
    (body) => response.writeHead(200, { 'Content-Type': type }).end(body),
    () => response.writeHead(404).end('missing'),
  );
}).listen(port, '127.0.0.1', () => {
  console.log(`Browser pane fixtures on http://127.0.0.1:${port}/`);
});
