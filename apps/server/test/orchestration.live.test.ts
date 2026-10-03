import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestCancel } from '../src/persistence/runs.ts';
import { live, repoWith, runLive, startLive, stopLive } from './orchestration-live-support.ts';

beforeAll(() => startLive());
afterAll(() => stopLive());

describe('live orchestration', () => {
  it('(a) fixes a trivial typo on Auto with one Builder and no planner', async () => {
    const repo = await repoWith('trivial', { 'README.md': '# Helo world\n\nA tiny probe repo.\n' });
    const run = await runLive(repo, 'Fix the typo in the README heading.', 'hands-off');
    expect(run.orchestration.status).toBe('succeeded');
    expect(run.orchestration.crew.some((member) => member.role === 'architect')).toBe(false);
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toContain('# Hello world');
  }, 600_000);

  it('(b) plans, builds and reviews a multi-file change at Automatic', async () => {
    const repo = await repoWith('multi', {
      'a.js': 'export function formatA(d) {\n  return d.toISOString().slice(0, 10);\n}\n',
      'b.js': 'export function formatB(d) {\n  return d.toISOString().slice(0, 10);\n}\n',
      'main.js':
        "import { formatA } from './a.js';\nimport { formatB } from './b.js';\nconsole.log(formatA(new Date()), formatB(new Date()));\n",
    });
    const run = await runLive(
      repo,
      'Move the duplicated date formatting in a.js and b.js into one new module dates.js exporting formatDate, update a.js, b.js and main.js to use it, and delete the duplicates. This touches several files, so plan it first and have the change reviewed.',
      'hands-off',
    );
    expect(run.orchestration.status).toBe('succeeded');
  }, 900_000);

  it('(c) stops mid-Builder', async () => {
    const repo = await repoWith('stop', {
      'a.js': 'export function formatA(d) {\n  return d.toISOString().slice(0, 10);\n}\n',
      'b.js': 'export function formatB(d) {\n  return d.toISOString().slice(0, 10);\n}\n',
    });
    let stoppedAt: number | null = null;
    const run = await runLive(
      repo,
      'Move the duplicated date formatting in a.js and b.js into one new module dates.js, update both files to use it, and add a README.md section describing the module. Plan it first.',
      'hands-off',
      async (view) => {
        const building = view?.crew.find(
          (member) => member.role === 'builder' && member.status === 'running',
        );
        if (
          building &&
          stoppedAt === null &&
          Date.now() - Date.parse(building.startedAt ?? '') > 5_000
        ) {
          stoppedAt = Date.now();
          await requestCancel(live.t.db, view!.runId);
        }
      },
    );
    console.log(
      JSON.stringify({ stoppedAt, finishedAfterStopMs: stoppedAt ? Date.now() - stoppedAt : null }),
    );
    expect(stoppedAt).not.toBeNull();
    expect(run.orchestration.status).toBe('cancelled');
    expect(run.orchestration.crew.at(-1)?.status).toBe('cancelled');
  }, 900_000);
});
