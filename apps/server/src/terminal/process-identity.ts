import { execFile } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import { isAlive, killProcessTree } from './process-group.ts';

const run = promisify(execFile);
const recordSchema = z.object({ pid: z.number().int().positive(), started: z.string().min(1) });
const RECHECK_MS = 50;

export async function processStartedAt(pid: number): Promise<string | null> {
  try {
    const { stdout } = await run('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      env: { ...process.env, LC_ALL: 'C' },
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function recordProcess(file: string, pid: number): Promise<void> {
  const started = await processStartedAt(pid);
  if (!started) return;
  const partial = `${file}.partial`;
  await writeFile(partial, JSON.stringify({ pid, started }), { mode: 0o600 });
  await rename(partial, file);
}

async function recorded(file: string): Promise<z.infer<typeof recordSchema> | null> {
  try {
    return recordSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

export async function endRecordedProcess(
  file: string,
  kill: (pid: number) => Promise<void> | void = killProcessTree,
): Promise<boolean> {
  const earlier = await recorded(file);
  if (!earlier || !isAlive(earlier.pid)) return false;
  if ((await processStartedAt(earlier.pid)) !== earlier.started) return false;
  await kill(earlier.pid);
  while (isAlive(earlier.pid) && (await processStartedAt(earlier.pid)) === earlier.started)
    await new Promise((done) => setTimeout(done, RECHECK_MS));
  return true;
}
