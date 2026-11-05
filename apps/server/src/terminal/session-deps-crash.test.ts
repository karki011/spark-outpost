import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { isAlive } from './process-group.ts';
import { pendingDir, sessionDeps, type DepsEnded } from './session-deps.ts';

const CHAT = 'chat-1';
const INSTALLER = [
  '#!/bin/sh',
  'lock="$SPARK_TEST_INSTALL_LOG.pid"',
  'if [ -f "$lock" ] && kill -0 "$(cat "$lock")" 2>/dev/null; then echo "overlap $$" >> "$SPARK_TEST_INSTALL_LOG"; fi',
  'echo $$ > "$lock"',
  'echo "start $$" >> "$SPARK_TEST_INSTALL_LOG"',
  'while [ ! -f "$SPARK_TEST_INSTALL_RELEASE" ]; do sleep 0.1; done',
  'mkdir -p node_modules',
  'echo "end $$" >> "$SPARK_TEST_INSTALL_LOG"',
  '',
].join('\n');
const WAIT = { timeout: 20_000, interval: 50 };

let root: string;
let main: string;
let copy: string;
let marker: string;
let log: string;
let release: string;
let env: NodeJS.ProcessEnv;
const strays: number[] = [];

const logged = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
const started = () =>
  logged()
    .filter((line) => line.startsWith('start '))
    .map((line) => Number(line.slice(6)));
const db = { query: async () => ({ rows: [{ repo_root: main }] }) } as unknown as Db;

function crashingSpark(): Promise<number> {
  const code = `import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'session-deps.ts')).href)}).then((m) => { m.sessionDeps().start('chat-1', { main: ${JSON.stringify(main)}, copy: ${JSON.stringify(copy)} }); setInterval(() => undefined, 1000); });`;
  const child = spawn(process.execPath, ['--import', 'tsx', '-e', code], { env, stdio: 'ignore' });
  strays.push(child.pid!);
  return new Promise((resolve) => {
    void vi
      .waitFor(() => {
        expect(started()).toHaveLength(1);
        expect(existsSync(join(marker, 'process.json'))).toBe(true);
      }, WAIT)
      .then(() => {
        child.once('exit', () => resolve(started()[0]!));
        child.kill('SIGKILL');
      });
  });
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'spark-deps-crash-')));
  main = join(root, 'main');
  mkdirSync(join(root, 'bin'));
  mkdirSync(main);
  writeFileSync(join(root, 'bin', 'pnpm'), INSTALLER);
  chmodSync(join(root, 'bin', 'pnpm'), 0o755);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', main, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(main, 'package.json'), '{"name":"app","packageManager":"pnpm@10.0.0"}');
  writeFileSync(join(main, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  git('add', '.');
  git('commit', '-qm', 'base');
  copy = join(main, '.spark', 'worktrees', 'one');
  git('worktree', 'add', '--quiet', '-b', 'spark/one', copy);
  marker = (await pendingDir(copy))!;
  log = join(root, 'install.log');
  release = join(root, 'release');
  env = {
    ...process.env,
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    SPARK_TEST_INSTALL_LOG: log,
    SPARK_TEST_INSTALL_RELEASE: release,
  };
  vi.stubEnv('PATH', env.PATH!);
  vi.stubEnv('SPARK_TEST_INSTALL_LOG', log);
  vi.stubEnv('SPARK_TEST_INSTALL_RELEASE', release);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const pid of [...strays.splice(0), ...started()]) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      continue;
    }
  }
  rmSync(root, { recursive: true, force: true });
});

describe(
  'dependency preparation after Spark crashed in the middle of it',
  { timeout: 60_000 },
  () => {
    it('ends the installer the crash left running before it installs again, then finishes', async () => {
      const orphan = await crashingSpark();
      expect(isAlive(orphan)).toBe(true);
      const ended: DepsEnded[] = [];
      const deps = sessionDeps({ ended: (result) => ended.push(result) });
      await deps.resume(db, CHAT, copy);
      await vi.waitFor(() => expect(started()).toHaveLength(2), WAIT);
      expect(isAlive(orphan)).toBe(false);
      const [, second] = started();
      expect(logged().slice(0, 3)).toEqual([`start ${orphan}`, `start ${second}`]);
      expect(deps.status(CHAT)).toMatchObject({ state: 'preparing' });
      writeFileSync(release, '');
      await vi.waitFor(() => expect(ended).toHaveLength(1), WAIT);
      expect(ended[0]).toMatchObject({ outcome: 'prepared', method: 'offline_install' });
      expect(logged()).toEqual([`start ${orphan}`, `start ${second}`, `end ${second}`]);
      expect(existsSync(join(copy, 'node_modules'))).toBe(true);
      expect(existsSync(marker)).toBe(false);
      expect(deps.status(CHAT)).toBeNull();
    });

    it('never signals a process whose start time is not the recorded one', async () => {
      const bystander = spawn('/bin/sleep', ['60'], { detached: true, stdio: 'ignore' });
      strays.push(bystander.pid!);
      mkdirSync(marker, { recursive: true });
      writeFileSync(
        join(marker, 'process.json'),
        JSON.stringify({ pid: bystander.pid, started: 'Thu Jan  1 00:00:00 1970' }),
      );
      writeFileSync(release, '');
      const ended: DepsEnded[] = [];
      const deps = sessionDeps({ ended: (result) => ended.push(result) });
      await deps.resume(db, CHAT, copy);
      await vi.waitFor(() => expect(ended).toHaveLength(1), WAIT);
      expect(ended[0]).toMatchObject({ outcome: 'prepared' });
      expect(isAlive(bystander.pid!)).toBe(true);
    });
  },
);
