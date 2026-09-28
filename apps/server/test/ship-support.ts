import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fakeGitHub, type FakeGitHub } from './fake-github.ts';

export const REMOTE_URL = 'https://github.com/acme/widgets.git';
export const FAKE_GH = path.resolve(import.meta.dirname, '../../../tests/browser/bin/gh');

export function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

export async function write(root: string, file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

export interface TestRepo {
  root: string;
  bare: string;
}

export async function repoWithRemote(
  base: string,
  name: string,
  remote: 'github' | 'none' = 'github',
): Promise<TestRepo> {
  const root = path.join(base, name);
  const bare = path.join(base, `${name}-remote.git`);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  git(root, 'config', 'user.name', 'Test Person');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'config', 'commit.gpgsign', 'false');
  await write(root, 'notes.txt', 'one\n');
  await write(root, 'mine.txt', 'mine\n');
  await write(root, 'staged.txt', 'staged\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'start');
  if (remote === 'github') {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    git(root, 'remote', 'add', 'origin', REMOTE_URL);
    git(root, 'config', 'remote.origin.pushurl', bare);
    git(root, 'push', '-q', 'origin', 'main');
    git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  }
  return { root, bare };
}

export interface GitHubStub {
  github: FakeGitHub;
  url: string;
  close(): Promise<void>;
}

export async function startGitHubStub(): Promise<GitHubStub> {
  const github = fakeGitHub();
  const server: Server = createServer((req, res) => {
    void github.handle(req, res, req.url ?? '/');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    github,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
