import type { ShipState } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface TaskShip {
  rootPath: string;
  branch: string;
  baseBranch: string | null;
  remote: string | null;
  lastCommit: string | null;
  pushedAt: Date | null;
  prUrl: string | null;
  prNumber: number | null;
  /** Full auto ships commit on the branch without switching the user's checkout. */
  keepsCheckout?: boolean;
}

interface ShipRow {
  root_path: string;
  branch: string;
  base_branch: string | null;
  remote: string | null;
  last_commit: string | null;
  pushed_at: Date | null;
  pr_url: string | null;
  pr_number: number | null;
  keeps_checkout: boolean;
}

export async function getTaskShip(db: Queryable, taskId: string): Promise<TaskShip | null> {
  const { rows } = await db.query<ShipRow>('SELECT * FROM task_ships WHERE task_id = $1', [taskId]);
  const row = rows[0];
  if (!row) return null;
  return {
    rootPath: row.root_path,
    branch: row.branch,
    baseBranch: row.base_branch,
    remote: row.remote,
    lastCommit: row.last_commit,
    pushedAt: row.pushed_at,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    keepsCheckout: row.keeps_checkout,
  };
}

export async function saveTaskShip(db: Queryable, taskId: string, ship: TaskShip): Promise<void> {
  await db.query(
    `INSERT INTO task_ships (task_id, root_path, branch, base_branch, remote, last_commit,
       pushed_at, pr_url, pr_number, keeps_checkout)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (task_id) DO UPDATE SET root_path = EXCLUDED.root_path,
       branch = EXCLUDED.branch, base_branch = EXCLUDED.base_branch, remote = EXCLUDED.remote,
       last_commit = EXCLUDED.last_commit, pushed_at = EXCLUDED.pushed_at,
       pr_url = EXCLUDED.pr_url, pr_number = EXCLUDED.pr_number,
       keeps_checkout = EXCLUDED.keeps_checkout, updated_at = now()`,
    [
      taskId,
      ship.rootPath,
      ship.branch,
      ship.baseBranch,
      ship.remote,
      ship.lastCommit,
      ship.pushedAt,
      ship.prUrl,
      ship.prNumber,
      ship.keepsCheckout ?? false,
    ],
  );
}

export function shipState(ship: TaskShip | null): ShipState | null {
  if (!ship) return null;
  return {
    branch: ship.branch,
    commit: ship.lastCommit,
    pushedAt: ship.pushedAt?.toISOString() ?? null,
    pullRequest: ship.prUrl && ship.prNumber ? { url: ship.prUrl, number: ship.prNumber } : null,
  };
}
