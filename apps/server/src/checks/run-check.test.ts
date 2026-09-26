import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECK_OUTPUT_TAIL_BYTES } from '@spark-outpost/contracts';
import { checkEnv, OutsideProjectError, OutputTail, runCheck } from './run-check.ts';

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-check-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const node = (script: string) => ({
  kind: 'test' as const,
  command: 'node -e …',
  argv: [process.execPath, '-e', script],
});

describe('running a check', () => {
  it('records the exit code and the redacted end of the output', async () => {
    const run = await runCheck(
      node("console.log('token sk-abcdefghijklmnopqrstuv'); console.error('bad'); process.exit(2)"),
      { root, cwd: root },
    );
    expect(run.exitCode).toBe(2);
    expect(run.timedOut).toBe(false);
    expect(run.outputTail).toContain('bad');
    expect(run.outputTail).not.toContain('sk-abcdefghijklmnopqrstuv');
  });

  it('keeps only the last 8 KB of long output', async () => {
    const run = await runCheck(node("process.stdout.write('x'.repeat(50000) + 'END')"), {
      root,
      cwd: root,
    });
    expect(run.exitCode).toBe(0);
    expect(run.truncated).toBe(true);
    expect(run.outputTail.length).toBeLessThanOrEqual(CHECK_OUTPUT_TAIL_BYTES);
    expect(run.outputTail.endsWith('END')).toBe(true);
  });

  it('stops a check that runs past its time limit', async () => {
    const run = await runCheck(node('setInterval(() => {}, 1000)'), {
      root,
      cwd: root,
      timeoutMs: 300,
    });
    expect(run.timedOut).toBe(true);
    expect(run.exitCode).toBeNull();
  });

  it('stops when the orchestration is stopped', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const run = await runCheck(node('setInterval(() => {}, 1000)'), {
      root,
      cwd: root,
      signal: controller.signal,
    });
    expect(run.cancelled).toBe(true);
  });

  it('runs in a folder inside the project and never outside it', async () => {
    const inner = join(root, 'packages', 'a');
    await mkdir(inner, { recursive: true });
    const run = await runCheck(node('console.log(process.cwd())'), { root, cwd: inner });
    expect(run.outputTail.trim()).toBe(inner);
    await expect(runCheck(node(''), { root: inner, cwd: root })).rejects.toBeInstanceOf(
      OutsideProjectError,
    );
  });

  it('hides credentials and database settings from the check', () => {
    const env = checkEnv({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'x',
      GITHUB_TOKEN: 'y',
      DATABASE_URL: 'postgres://',
      PGPASSWORD: 'z',
    });
    expect(env).toEqual({ PATH: '/bin', CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' });
  });

  it('keeps the tail across many small chunks', () => {
    const tail = new OutputTail(10);
    for (const chunk of ['abcdef', 'ghijkl', 'mnop']) tail.push(Buffer.from(chunk));
    expect(tail.text()).toEqual({ text: 'ghijklmnop', truncated: true });
  });
});
