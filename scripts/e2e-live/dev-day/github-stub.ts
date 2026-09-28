import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const GITHUB_STUB_PORT = 4429;
export const GITHUB_STUB_URL = `http://127.0.0.1:${GITHUB_STUB_PORT}`;

export interface StubPull {
  number: number;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
  html_url: string;
}

export interface GitHubStub {
  url: string;
  pulls: StubPull[];
  requests: string[];
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
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

const REPO = /^\/repos\/([^/]+)\/([^/]+)(\/pulls(?:\/(\d+))?)?$/;

/**
 * A GitHub REST stand-in for the Full auto draft PR: /user, /repos/:owner/:repo and its pulls.
 * Any bearer token is accepted and nothing leaves this process.
 */
export async function startGitHubStub(port = GITHUB_STUB_PORT): Promise<GitHubStub> {
  const pulls: StubPull[] = [];
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://stub');
      requests.push(`${req.method} ${url.pathname}`);
      if (url.pathname === '/health') return send(res, 200, { ok: true });
      if (url.pathname === '/user') return send(res, 200, { login: 'dev-day' });
      const match = REPO.exec(url.pathname);
      if (!match) return send(res, 404, { message: 'Not Found' });
      const [, owner, repo, pullsPath] = match;
      const slug = `${owner}/${repo}`;
      if (!pullsPath) {
        return send(res, 200, {
          full_name: slug,
          default_branch: 'main',
          permissions: { push: true, pull: true },
        });
      }
      if (req.method === 'GET') {
        const head = url.searchParams.get('head');
        return send(
          res,
          200,
          pulls.filter((pull) => pull.repo === slug && (!head || `${owner}:${pull.head}` === head)),
        );
      }
      const body = await readJson(req);
      if (req.method === 'PATCH') {
        const pull = pulls.find((entry) => entry.number === Number(match[4]));
        if (!pull) return send(res, 404, { message: 'Not Found' });
        pull.title = String(body.title ?? pull.title);
        pull.body = String(body.body ?? pull.body);
        return send(res, 200, pull);
      }
      if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed' });
      const number = pulls.length + 1;
      const pull: StubPull = {
        number,
        repo: slug,
        title: String(body.title ?? ''),
        body: String(body.body ?? ''),
        head: String(body.head ?? ''),
        base: String(body.base ?? 'main'),
        draft: body.draft === true,
        html_url: `https://github.e2e.localhost/${slug}/pull/${number}`,
      };
      pulls.push(pull);
      return send(res, 201, pull);
    })();
  });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${port}`,
    pulls,
    requests,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
