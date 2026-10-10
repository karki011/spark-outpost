import { createServer } from 'node:http';
import { record, token } from './run-state.mjs';

const port = Number(process.env.PORT ?? 47310);
const title = `Ledger dev ${token()}`;
const page = `<!doctype html><html><head><title>${title}</title></head><body><h1>Ledger</h1></body></html>`;

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
});

function stop() {
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

server.listen(port, '127.0.0.1', async () => {
  await record('dev-server.json', { pid: process.pid, port, title });
  console.log(`dev server listening on http://127.0.0.1:${port}/ (pid ${process.pid})`);
});
