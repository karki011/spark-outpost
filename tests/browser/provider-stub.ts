import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fakeGitHub, type FakePull } from '../../apps/server/test/fake-github.ts';
import type { FakeGitHubApp } from '../../apps/server/test/fake-github-app.ts';
import { jevAnswers, type StubRequest } from './jev-stub.ts';
import { REJECTED_KEY_MARKER, STUB_PORT } from './stub-config.ts';
import { fakeSlack } from '../../apps/server/test/fake-slack.ts';
import { ticketFakes } from './ticket-stub.ts';

const anthropicModels = {
  data: [
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
  ],
};

const openaiModels = { data: [{ id: 'gpt-5-codex' }, { id: 'gpt-5' }, { id: 'gpt-5-mini' }] };

const typesafeModels = {
  models: [
    { name: 'jev-latest', description: 'Latest stable Jev', release_date: '2026-01-01' },
    { name: 'jev-preview', description: 'Newest Jev build', release_date: '2026-01-01' },
  ],
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
    usage: { input_tokens: text.length / 4, output_tokens: 0 },
  });
}

function credential(req: IncomingMessage): string {
  return String(req.headers['x-api-key'] ?? req.headers.authorization ?? '');
}

let github = fakeGitHub();

async function updatePull(req: IncomingMessage, res: ServerResponse, number: number) {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  const pull = github.pulls.find((entry) => entry.number === number);
  if (!pull) return send(res, 404, { error: 'no such pull request' });
  Object.assign(pull, JSON.parse(text || '{}') as Partial<FakePull>);
  send(res, 200, pull);
}
async function addPull(req: IncomingMessage, res: ServerResponse) {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  const fields = JSON.parse(text || '{}') as Partial<FakePull> & { number: number };
  const pull: FakePull = {
    owner: 'acme',
    repo: 'widgets',
    title: `PR ${fields.number}`,
    body: '',
    head: `spark/pr-${fields.number}`,
    base: 'main',
    draft: false,
    state: 'open',
    html_url: `https://github.com/acme/widgets/pull/${fields.number}`,
    openedBy: 'octo-cli',
    via: 'gh_cli',
    ...fields,
  };
  github.pulls.push(pull);
  send(res, 201, pull);
}
async function setApp(req: IncomingMessage, res: ServerResponse) {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  const { revoke, ...fields } = JSON.parse(text || '{}') as Partial<FakeGitHubApp> & {
    revoke?: boolean;
  };
  Object.assign(github.app, fields);
  if (revoke) github.app.revokeAccess();
  send(res, 200, { ok: true });
}
const tickets = ticketFakes();
let slack = fakeSlack();

const server = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/health') return send(res, 200, { ok: true });
  if (path === '/github-test/pulls' && req.method === 'POST') return void addPull(req, res);
  if (path === '/github-test/pulls') return send(res, 200, github.pulls);
  const pullNumber = /^\/github-test\/pulls\/(\d+)$/.exec(path ?? '')?.[1];
  if (pullNumber && req.method === 'POST') return void updatePull(req, res, Number(pullNumber));
  if (path === '/github-test/app' && req.method === 'POST') return void setApp(req, res);
  if (path === '/github-test/reset') {
    github = fakeGitHub();
    return send(res, 200, { ok: true });
  }
  if (path?.startsWith('/github/')) {
    return void github.handle(req, res, (req.url ?? '').slice('/github'.length));
  }
  if (path === '/slack-test/reset') {
    slack = fakeSlack();
    return send(res, 200, { ok: true });
  }
  if (path === '/slack-test/posted') return send(res, 200, slack.posted);
  if (path?.startsWith('/slack/api/')) return void slack.handle(req, res);
  if (path === '/tickets-test/reset') {
    tickets.reset();
    return send(res, 200, { ok: true });
  }
  if (path === '/tickets-test/deny-assign') {
    tickets.denyAssign('API');
    return send(res, 200, { ok: true });
  }
  if (path && tickets.handles(path)) return void tickets.handle(req, res, path);
  if (credential(req).includes(REJECTED_KEY_MARKER))
    return send(res, 401, { error: 'invalid key' });
  if (path === '/anthropic/v1/models') return send(res, 200, anthropicModels);
  if (path === '/anthropic/v1/messages' && req.method === 'POST') {
    return send(res, 200, { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'OK' }] });
  }
  if (path === '/zai/v1/messages' && req.method === 'POST') {
    return send(res, 200, { model: 'glm-5.3-flash', content: [{ type: 'text', text: 'OK' }] });
  }
  if (path === '/openai/v1/models') return send(res, 200, openaiModels);
  if (path === '/typesafe/v1/models') return send(res, 200, typesafeModels);
  if (path === '/typesafe/v1/systemone' && req.method === 'POST') return void systemOne(req, res);
  return send(res, 404, { error: 'not found' });
});

server.listen(STUB_PORT, '127.0.0.1');
