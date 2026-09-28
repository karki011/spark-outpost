import { createServer, type Server } from 'node:http';
import { fakeGitHub, type FakePull } from '../../../apps/server/test/fake-github.ts';

export const GITHUB_STUB_PORT = 4429;
export const GITHUB_STUB_URL = `http://127.0.0.1:${GITHUB_STUB_PORT}`;

export const FAKE_GITHUB_TOKEN = 'ghp_devday0fake0github0token0never0real';

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
  foreignCredentials: string[];
  close(): Promise<void>;
}

const toStubPull = (pull: FakePull): StubPull => ({
  number: pull.number,
  repo: `${pull.owner}/${pull.repo}`,
  title: pull.title,
  body: pull.body,
  head: pull.head,
  base: pull.base,
  draft: pull.draft,
  html_url: pull.html_url,
});

export async function startGitHubStub(port = GITHUB_STUB_PORT): Promise<GitHubStub> {
  const fake = fakeGitHub();
  const requests: string[] = [];
  const foreignCredentials: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/';
    const pathname = new URL(path, 'http://stub').pathname;
    requests.push(`${req.method} ${pathname}`);
    if (pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    const auth = String(req.headers.authorization ?? '');
    if (auth !== `Bearer ${FAKE_GITHUB_TOKEN}`) {
      foreignCredentials.push(
        `${req.method} ${pathname}: ${auth ? `${auth.slice(0, 12)}…` : '(no authorization)'}`,
      );
    }
    void fake.handle(req, res, path).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${port}`,
    get pulls() {
      return fake.pulls.map(toStubPull);
    },
    requests,
    foreignCredentials,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
