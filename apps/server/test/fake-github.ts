import type { IncomingMessage, ServerResponse } from 'node:http';
import { listPullsAnswer, pullJson, pullReadAnswer } from './fake-github-reads.ts';

export const FAKE_GH_HEADER = 'x-fake-gh';
export const REJECTED_TOKEN_MARKER = 'rejected';
export const TOKEN_LOGIN = 'octo-token';
export const TOKEN_EXPIRY = '2026-12-31 00:00:00 UTC';

export interface FakePull {
  number: number;
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
  state: 'open' | 'closed';
  merged?: boolean;
  created_at?: string;
  reviews?: { user: { login: string }; state: string }[];
  html_url: string;
  openedBy: string;
  via: 'gh_cli' | 'token';
  sha?: string;
  updated_at?: string;
  mergeable?: boolean | null;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  files?: { filename: string; status: string; additions: number; deletions: number }[];
  reviewComments?: { path: string; line: number | null; user: { login: string }; body: string }[];
  issueComments?: { user: { login: string }; body: string }[];
  checks?: { name: string; status: string; conclusion: string | null }[];
}

export interface FakeGitHub {
  pulls: FakePull[];
  handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
}

interface Caller {
  login: string;
  via: FakePull['via'];
  scopes: string | null;
}

function send(res: ServerResponse, status: number, body: unknown, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function caller(req: IncomingMessage): Caller | null {
  const viaGh = req.headers[FAKE_GH_HEADER];
  if (typeof viaGh === 'string' && viaGh) return { login: viaGh, via: 'gh_cli', scopes: null };
  const auth = String(req.headers.authorization ?? '');
  const token = /^Bearer (\S+)$/.exec(auth)?.[1];
  if (!token || token.includes(REJECTED_TOKEN_MARKER)) return null;
  return { login: TOKEN_LOGIN, via: 'token', scopes: token.startsWith('ghp_') ? 'repo' : null };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  try {
    return JSON.parse(text || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

const REPO = /^\/repos\/([^/]+)\/([^/]+)(\/pulls(?:\/(\d+))?)?(\/reviews)?$/;

export function fakeGitHub(): FakeGitHub {
  const pulls: FakePull[] = [];

  function repoAnswer(res: ServerResponse, owner: string, repo: string) {
    if (repo === 'missing') return send(res, 404, { message: 'Not Found' });
    send(res, 200, {
      full_name: `${owner}/${repo}`,
      default_branch: 'main',
      permissions: { push: !repo.includes('readonly'), pull: true },
    });
  }

  async function pullsAnswer(
    req: IncomingMessage,
    res: ServerResponse,
    who: Caller,
    match: RegExpExecArray,
    query: URLSearchParams,
  ) {
    const [, owner, repo, , number, reviews] = match as unknown as [
      string,
      string,
      string,
      string,
      string?,
      string?,
    ];
    if (req.method === 'GET' && number) {
      const pull = pulls.find(
        (entry) => entry.owner === owner && entry.repo === repo && entry.number === Number(number),
      );
      if (!pull) return send(res, 404, { message: 'Not Found' });
      if (reviews) return send(res, 200, pull.reviews ?? []);
      return send(res, 200, pullJson(pull));
    }
    if (req.method === 'GET') {
      const answer = listPullsAnswer(pulls, owner, repo, query);
      return send(res, answer.status, answer.body);
    }
    const body = await readJson(req);
    if (req.method === 'PATCH' && number) {
      const pull = pulls.find((entry) => entry.number === Number(number) && entry.repo === repo);
      if (!pull) return send(res, 404, { message: 'Not Found' });
      pull.title = String(body.title ?? pull.title);
      pull.body = String(body.body ?? pull.body);
      return send(res, 200, pull);
    }
    if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed' });
    if (pulls.some((pull) => pull.repo === repo && pull.head === body.head)) {
      return send(res, 422, { message: 'A pull request already exists' });
    }
    const created: FakePull = {
      number: pulls.length + 1,
      owner,
      repo,
      title: String(body.title),
      body: String(body.body),
      head: String(body.head),
      base: String(body.base),
      draft: body.draft === true,
      state: 'open',
      html_url: `https://github.com/${owner}/${repo}/pull/${pulls.length + 1}`,
      openedBy: who.login,
      via: who.via,
    };
    pulls.push(created);
    send(res, 201, created);
  }

  return {
    pulls,
    async handle(req, res, path) {
      const url = new URL(path, 'http://fake');
      const who = caller(req);
      if (!who) return send(res, 401, { message: 'Bad credentials' });
      if (url.pathname === '/user') {
        return send(
          res,
          200,
          { login: who.login },
          {
            'github-authentication-token-expiration': TOKEN_EXPIRY,
            ...(who.scopes ? { 'x-oauth-scopes': who.scopes } : {}),
          },
        );
      }
      const read =
        req.method === 'GET' ? pullReadAnswer(pulls, url.pathname, url.searchParams) : null;
      if (read) return send(res, read.status, read.body);
      const match = REPO.exec(url.pathname);
      if (!match) return send(res, 404, { message: 'Not Found' });
      if (!match[3]) return repoAnswer(res, match[1]!, match[2]!);
      return pullsAnswer(req, res, who, match, url.searchParams);
    },
  };
}
