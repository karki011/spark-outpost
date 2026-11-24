import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { childEnvironment } from '../../setup/environment.ts';
import { isAlive } from '../process-group.ts';
import type { SpawnPty } from '../pty.ts';
import { HOST_ENTRY } from './host-launch.ts';
import { hostKept } from './host-kept.ts';
import { sessionHostPaths, type SessionHostPaths } from './paths.ts';

const SERVER_DIR = resolve(import.meta.dirname, '../../../');
const FAKE_API = join(SERVER_DIR, 'test/fake-session-host-api.ts');
const ECHO = [
  "process.stdout.write('ready:' + process.pid + '\\n');",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (d) => { if (d.includes('quit')) process.exit(5);",
  "  if (d.includes('ping')) process.stdout.write('pong\\n'); });",
].join(' ');

const refused: SpawnPty = () => {
  throw new Error('The direct PTY was used.');
};

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

describe('a session host whose API is killed', { timeout: 90_000 }, () => {
  let folder: string;
  let paths: SessionHostPaths;

  const kept = () =>
    hostKept(
      {
        paths,
        launcher: {
          file: process.execPath,
          args: ['--import', 'tsx', HOST_ENTRY],
          env: childEnvironment(process.env),
        },
      },
      () => undefined,
    );

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'shs-'));
    paths = sessionHostPaths(join(folder, 'host'));
  });

  afterEach(async () => {
    await kept().stopAll();
    rmSync(folder, { recursive: true, force: true });
  });

  it('keeps the session running, and a new client adopts it with its output', async () => {
    const api = spawn(process.execPath, ['--import', 'tsx', FAKE_API, paths.directory, ECHO], {
      cwd: SERVER_DIR,
      env: childEnvironment(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let printed = '';
    let errors = '';
    api.stdout.on('data', (chunk: Buffer) => {
      printed += chunk.toString();
    });
    api.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    const gone = new Promise<void>((done) => api.once('exit', () => done()));
    await until(() => /started \d+/.test(printed), `the fake API to start a session ${errors}`);
    const cli = Number(/started (\d+)/.exec(printed)![1]);

    api.kill('SIGKILL');
    await gone;

    const again = kept();
    expect(await again.listSessionIds()).toEqual(['s1']);
    expect(isAlive(cli)).toBe(true);
    const adopted = again.spawner(refused)({
      sessionId: 's1',
      command: process.execPath,
      cols: 80,
      rows: 24,
      adopt: true,
    });
    let output = '';
    adopted.onData((data) => {
      output += data;
    });
    const exit = new Promise<{ exitCode: number }>((done) => adopted.onExit(done));
    await until(() => output.includes(`ready:${cli}`), 'the replay');
    adopted.write('ping\r');
    await until(() => output.includes('pong'), 'the session to answer');
    adopted.write('quit\r');
    expect(await exit).toEqual({ exitCode: 5 });
  });
});
