import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { recordProcess } from './process-identity.ts';

const children: ChildProcess[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function sleeper(): number {
  const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  children.push(child);
  return child.pid!;
}

it('keeps the record of the process started last when two writes overlap', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'process-identity-'));
  folders.push(folder);
  const file = join(folder, 'process.json');
  const pids = Array.from({ length: 5 }, sleeper);
  await Promise.all(pids.map((pid) => recordProcess(file, pid)));
  expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ pid: pids.at(-1) });
});
