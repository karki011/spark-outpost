import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { jevAnswers, type StubRequest } from '../../tests/browser/jev-stub.ts';
import { STUB_PORT } from './config.ts';

const MODELS: Record<string, unknown> = {
  '/typesafe/v1/models': {
    models: [{ name: 'jev-latest', description: 'Jev', release_date: '2026-01-01' }],
  },
  '/anthropic/v1/models': { data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }] },
  '/openai/v1/models': { data: [{ id: 'gpt-6-sol' }] },
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function systemOne(req: IncomingMessage, res: ServerResponse) {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  send(res, 200, {
    model: 'jev-stub',
    answers: jevAnswers(JSON.parse(text) as StubRequest),
    usage: { input_tokens: Math.round(text.length / 4), output_tokens: 0 },
  });
}

createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0] ?? '';
  if (path === '/health') return send(res, 200, { ok: true });
  if (path === '/typesafe/v1/systemone' && req.method === 'POST') return void systemOne(req, res);
  if (MODELS[path]) return send(res, 200, MODELS[path]);
  return send(res, 404, { error: 'not found' });
}).listen(STUB_PORT, '127.0.0.1');
