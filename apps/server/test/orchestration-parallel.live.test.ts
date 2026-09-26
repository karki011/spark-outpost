import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Orchestration } from '@spark-outpost/contracts';
import { latestPlan } from '../src/persistence/artifacts.ts';
import { live, repoWith, runLive, startLive, stopLive } from './orchestration-live-support.ts';

const FILES = {
  'a.js': 'export function formatA(d) {\n  return d.toISOString().slice(0, 10);\n}\n',
  'b.js': 'export function formatB(d) {\n  return d.toISOString().slice(0, 10);\n}\n',
  'README.md': '# Dates\n\nTwo files format dates the same way.\n',
};

const REQUEST =
  'Plan it first, in exactly 3 steps. Step 1: create dates.js exporting formatDate(d) that returns d.toISOString().slice(0, 10). Step 2: change a.js so formatA calls formatDate from ./dates.js. Step 3: change b.js so formatB calls formatDate from ./dates.js. Steps 2 and 3 touch different files and do not depend on each other.';

beforeAll(() => startLive());
afterAll(() => stopLive());

function builderSpan(orchestration: Orchestration) {
  const builders = orchestration.crew.filter((member) => member.role === 'builder');
  const grouped = builders.filter((member) => member.parallelGroup);
  const starts = grouped.map((member) => Date.parse(member.startedAt ?? ''));
  const ends = grouped.map((member) => Date.parse(member.finishedAt ?? ''));
  return {
    builders: builders.map((member) => ({
      name: member.name,
      group: member.parallelGroup ?? null,
      copy: member.copy ?? null,
      durationMs: member.durationMs,
      costUsd: member.costUsd,
    })),
    groupWallMs: grouped.length > 1 ? Math.max(...ends) - Math.min(...starts) : null,
    groupSumMs: grouped.reduce((sum, member) => sum + (member.durationMs ?? 0), 0),
    builderSumMs: builders.reduce((sum, member) => sum + (member.durationMs ?? 0), 0),
    totalCostUsd: orchestration.totals.costUsd,
    jevCostUsd: orchestration.totals.jevCostUsd,
    parallelNote: orchestration.parallelNote ?? null,
  };
}

async function plainFolder(name: string): Promise<string> {
  const folder = join(live.base, name);
  await mkdir(folder, { recursive: true });
  for (const [file, content] of Object.entries(FILES)) await writeFile(join(folder, file), content);
  return folder;
}

async function save(report: Record<string, unknown>): Promise<void> {
  const target = join(dirname(live.base), 'parallel-live-report.json');
  await writeFile(target, JSON.stringify(report, null, 2));
}

async function architectReply(orchestration: Orchestration): Promise<string> {
  const architect = orchestration.crew.find((member) => member.role === 'architect');
  if (!architect) return '';
  const { rows } = await live.t.db.query<{ payload: { delta?: string } }>(
    `SELECT payload FROM run_events WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'
     ORDER BY seq`,
    [architect.runId],
  );
  return rows.map((row) => row.payload.delta ?? '').join('');
}

async function summary(orchestration: Orchestration) {
  const plan = orchestration.taskId ? await latestPlan(live.t.db, orchestration.taskId) : null;
  return {
    architectReply: await architectReply(orchestration),
    plan: plan?.entries.map((entry) => `${entry.status}: ${entry.content}`) ?? [],
    status: orchestration.status,
    depth: orchestration.depth,
    crew: orchestration.crew.map((member) => ({
      label: member.agentLabel,
      status: member.status,
      group: member.parallelGroup ?? null,
      startedAt: member.startedAt,
      finishedAt: member.finishedAt,
      durationMs: member.durationMs,
      costUsd: member.costUsd,
      costSource: member.costSource,
    })),
    checkpoints: orchestration.checkpoints.map((checkpoint) => checkpoint.title),
    totals: orchestration.totals,
  };
}

describe('live parallel Builders', () => {
  it('runs two independent steps in parallel copies and merges them back', async () => {
    const repo = await repoWith('parallel', FILES);
    const parallel = await runLive(repo, REQUEST, 'hands-off');
    expect(parallel.orchestration.status).toBe('succeeded');
    expect(await readFile(join(repo, 'a.js'), 'utf8')).toContain('formatDate');
    expect(await readFile(join(repo, 'b.js'), 'utf8')).toContain('formatDate');
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
      encoding: 'utf8',
    });
    const worktrees = execFileSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' });
    const merged = {
      a: await readFile(join(repo, 'a.js'), 'utf8'),
      b: await readFile(join(repo, 'b.js'), 'utf8'),
      dates: await readFile(join(repo, 'dates.js'), 'utf8').catch(() => null),
      status,
      worktrees,
      branches: execFileSync('git', ['-C', repo, 'branch', '--list', 'spark/*'], {
        encoding: 'utf8',
      }),
    };
    await save({ parallel: await summary(parallel.orchestration), merged });
    expect(worktrees).not.toContain('.spark');

    const plain = await plainFolder('sequential');
    const sequential = await runLive(plain, REQUEST, 'hands-off');
    await save({
      parallelElapsedMs: parallel.elapsedMs,
      sequentialElapsedMs: sequential.elapsedMs,
      parallelSpan: builderSpan(parallel.orchestration),
      sequentialSpan: builderSpan(sequential.orchestration),
      parallel: await summary(parallel.orchestration),
      sequential: await summary(sequential.orchestration),
      merged,
    });
    expect(sequential.orchestration.status).toBe('succeeded');
  }, 1_800_000);
});
