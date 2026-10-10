import type { Queryable } from '../persistence/db.ts';
import { saveDepsWait } from '../persistence/worktrees.ts';
import type { DepsPrep } from './worktree-deps.ts';

interface Pending {
  promise: Promise<DepsPrep | null>;
  waitedMs: number;
}

const pending = new Map<string, Pending>();

export async function awaitDepsPrep(db: Queryable, runId: string | null): Promise<number> {
  const entry = runId ? pending.get(runId) : undefined;
  if (!runId || !entry) return 0;
  const started = Date.now();
  const prep = await entry.promise;
  const waited = Date.now() - started;
  if (waited > 0) {
    entry.waitedMs += waited;
    if (prep) await saveDepsWait(db, runId, entry.waitedMs).catch(() => null);
  }
  return waited;
}

export async function settleDepsPrep(runId: string): Promise<void> {
  await pending.get(runId)?.promise;
  pending.delete(runId);
}
