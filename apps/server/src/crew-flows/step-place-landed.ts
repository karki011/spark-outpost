import type { Queryable } from '../persistence/db.ts';
import { fetchBranch } from '../projects/chat-worktrees.ts';
import { git } from '../projects/snapshot.ts';
import type { TurnWorkflowRun } from './run-records.ts';
import { PLACE_COMMITS_MAX, type LandedCommits, type PlaceCommit } from './step-place.ts';

interface LastScheduled {
  startedAt: Date;
  baseHead: string | null;
}

async function lastScheduledSuccess(
  db: Queryable,
  workspaceId: string,
  run: TurnWorkflowRun,
): Promise<LastScheduled | null> {
  const { rows } = await db.query<{ started_at: Date; base_head: string | null }>(
    `SELECT started_at, base_head FROM workflow_runs
     WHERE workspace_id = $1 AND workflow_id = $2 AND id <> $3 AND kind = 'run'
       AND source IN ('schedule', 'catch_up') AND status = 'succeeded'
     ORDER BY started_at DESC LIMIT 1`,
    [workspaceId, run.workflow.id, run.run.id],
  );
  const row = rows[0];
  return row ? { startedAt: row.started_at, baseHead: row.base_head } : null;
}

async function recordBaseHead(db: Queryable, run: TurnWorkflowRun, head: string): Promise<void> {
  await db.query('UPDATE workflow_runs SET base_head = $2 WHERE id = $1', [run.run.id, head]);
}

async function attempt<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

async function commitOf(root: string, ref: string): Promise<string | null> {
  const sha = await attempt(() => git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]));
  return sha?.trim() || null;
}

async function reaches(root: string, older: string, newer: string): Promise<boolean> {
  return (await attempt(() => git(root, ['merge-base', '--is-ancestor', older, newer]))) !== null;
}

function parseLog(output: string): PlaceCommit[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = ''] = line.split('\x1f');
      return { sha, subject };
    });
}

async function log(root: string, range: readonly string[]): Promise<PlaceCommit[]> {
  const format = ['log', `-n${PLACE_COMMITS_MAX}`, '--no-color', '--format=%h%x1f%s'];
  return parseLog(await git(root, [...format, ...range]));
}

async function baseTip(root: string, base: string) {
  for (const ref of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    const head = await commitOf(root, ref);
    if (head) return { head, ref };
  }
  return null;
}

export interface LandedAsk {
  db: Queryable;
  workspaceId: string;
  turn: TurnWorkflowRun;
  root: string;
  base: string | null;
}

export async function landedCommits(ask: LandedAsk): Promise<LandedCommits | null> {
  const { root, base } = ask;
  if (!base) return null;
  await fetchBranch(root, `origin/${base}`);
  const tip = await baseTip(root, base);
  if (!tip) return null;
  const { head, ref } = tip;
  await attempt(() => recordBaseHead(ask.db, ask.turn, head));
  const last = await attempt(() => lastScheduledSuccess(ask.db, ask.workspaceId, ask.turn));
  if (last?.baseHead && (await reaches(root, last.baseHead, head))) {
    return { since: 'last_run', commits: await log(root, [`${last.baseHead}..${ref}`]) };
  }
  if (last) {
    const window = `--since=${last.startedAt.toISOString()}`;
    return { since: 'date', commits: await log(root, [window, ref]) };
  }
  return { since: 'recent', commits: await log(root, [ref]) };
}
