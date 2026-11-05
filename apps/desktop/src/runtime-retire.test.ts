import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isRuntimeHost, recordedPid, retireHost } from './runtime-retire.ts';

let folder: string;
const children: ChildProcess[] = [];

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'spark-retire-'));
});
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

async function host(name: string, body: string, file = 'runtime-host.js') {
  const home = await mkdtemp(path.join(folder, `${name}-`));
  const directory = path.join(home, 'Application Support/runtime');
  await mkdir(directory, { recursive: true });
  const script = path.join(home, file);
  await writeFile(path.join(home, 'package.json'), '{"type":"commonjs"}');
  await writeFile(script, `${body}; process.stdout.write('up'); setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, [script, directory, '1.0.0'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  children.push(child);
  const exited = new Promise<NodeJS.Signals | null>((resolve) =>
    child.once('exit', (_code, signal) => resolve(signal)),
  );
  await new Promise((resolve) => child.stdout.once('data', resolve));
  return { directory, pid: child.pid!, exited, child };
}

describe('retiring an earlier runtime host', () => {
  it('recognises only a runtime host started for this directory', async () => {
    const ours = await host('ours', '');
    const other = await host('other', '', 'service.js');
    expect(await isRuntimeHost(ours.pid, ours.directory)).toBe(true);
    expect(await isRuntimeHost(ours.pid, path.dirname(ours.directory))).toBe(false);
    expect(await isRuntimeHost(ours.pid, other.directory)).toBe(false);
    expect(await isRuntimeHost(other.pid, other.directory)).toBe(false);
    expect(await isRuntimeHost(process.pid, ours.directory)).toBe(false);
  });

  it('reads the recorded pid and ignores a missing or malformed endpoint', async () => {
    const file = path.join(folder, 'endpoint.json');
    expect(await recordedPid(file)).toBeNull();
    await writeFile(file, JSON.stringify({ pid: 4321, version: '1.0.0' }));
    expect(await recordedPid(file)).toBe(4321);
    await writeFile(file, JSON.stringify({ pid: '4321' }));
    expect(await recordedPid(file)).toBeNull();
    await writeFile(file, JSON.stringify({ pid: 1 }));
    expect(await recordedPid(file)).toBeNull();
    await writeFile(file, 'not json');
    expect(await recordedPid(file)).toBeNull();
  });

  it('waits for the host to exit after it was asked to stop', async () => {
    const target = await host('graceful', '');
    let asked = false;
    await retireHost({
      directory: target.directory,
      pid: target.pid,
      stop: async () => {
        asked = true;
        target.child.kill('SIGINT');
      },
      timeoutMs: 5_000,
    });
    expect(asked).toBe(true);
    expect(await target.exited).toBe('SIGINT');
  });

  it('terminates a host that does not answer, then kills one that ignores the signal', async () => {
    const quiet = await host('quiet', '');
    await retireHost({ directory: quiet.directory, pid: quiet.pid, stop: null, timeoutMs: 5_000 });
    expect(await quiet.exited).toBe('SIGTERM');
    const stubborn = await host('stubborn', `process.on('SIGTERM', () => {})`);
    await retireHost({
      directory: stubborn.directory,
      pid: stubborn.pid,
      stop: () => new Promise(() => undefined),
      timeoutMs: 300,
    });
    expect(await stubborn.exited).toBe('SIGKILL');
  });

  it("never signals a process that is not this directory's runtime host", async () => {
    const other = await host('foreign', '', 'service.js');
    await retireHost({ directory: other.directory, pid: other.pid, stop: null, timeoutMs: 300 });
    expect(other.child.exitCode).toBeNull();
    expect(other.child.signalCode).toBeNull();
    await retireHost({ directory: other.directory, pid: null, stop: null, timeoutMs: 300 });
  });
});
