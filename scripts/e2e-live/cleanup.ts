import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../../apps/server/src/persistence/db.ts';

export async function builderStartedAt(db: Db, runId: string): Promise<number | null> {
  const { rows } = await db.query<{ started: Date | null }>(
    `SELECT min(started_at) AS started FROM runs WHERE parent_run_id = $1 AND role = 'builder'`,
    [runId],
  );
  return rows[0]?.started ? rows[0].started.getTime() : null;
}

function descendants(rootPid: number): { pid: number; command: string }[] {
  const table = execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }));
  const found: { pid: number; command: string }[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const row of table.filter((candidate) => candidate.ppid === parent)) {
      found.push({ pid: row.pid, command: row.command });
      queue.push(row.pid);
    }
  }
  return found;
}

async function count(db: Db, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.query<{ count: string }>(sql, params);
  return Number(rows[0]?.count ?? 0);
}

export async function cleanupProblems(
  db: Db,
  runId: string,
  conversationId: string,
  repo: string,
  workerPid: number | null,
): Promise<string[]> {
  const problems: string[] = [];
  const { rows } = await db.query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [
    runId,
  ]);
  if (rows[0]?.status !== 'cancelled')
    problems.push(`The run ended ${rows[0]?.status ?? 'unknown'}, not cancelled.`);
  const running = await count(
    db,
    `SELECT count(*) FROM runs WHERE parent_run_id = $1 AND status IN ('queued', 'running', 'awaiting_approval')`,
    [runId],
  );
  if (running > 0) problems.push(`${running} crew runs are still queued or running.`);
  const liveCopies = await count(
    db,
    'SELECT count(*) FROM run_worktrees WHERE orchestration_run_id = $1 AND removed_at IS NULL',
    [runId],
  );
  if (liveCopies > 0) problems.push(`${liveCopies} worktree records are not marked removed.`);
  const folders = await readdir(join(repo, '.spark', 'worktrees')).catch(() => []);
  if (folders.length > 0) problems.push(`${folders.length} worktree folders are left on disk.`);
  const worktrees = execFileSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  if (worktrees.length > 1)
    problems.push(`git still lists ${worktrees.length - 1} extra worktrees.`);
  const openSessions = await count(
    db,
    'SELECT count(*) FROM provider_sessions WHERE conversation_id = $1 AND closed_at IS NULL',
    [conversationId],
  );
  if (openSessions > 0) problems.push(`${openSessions} agent sessions are still open.`);
  const pending = await count(
    db,
    `SELECT count(*) FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND a.status = 'pending'`,
    [runId],
  );
  if (pending > 0) problems.push(`${pending} approvals are still pending.`);
  if (workerPid !== null) {
    const agents = descendants(workerPid).filter((row) =>
      /acp|claude|codex|fake-acp/.test(row.command),
    );
    if (agents.length > 0) problems.push(`${agents.length} agent processes are still running.`);
  }
  return problems;
}
