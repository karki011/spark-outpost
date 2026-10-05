import type { Queryable } from '../persistence/db.ts';
import { saveDeps, saveDepsWait } from '../persistence/worktrees.ts';
import { prepareDependencies, type DepsOptions, type DepsPrep } from './worktree-deps.ts';

interface Pending {
  promise: Promise<DepsPrep | null>;
  waitedMs: number;
}

const pending = new Map<string, Pending>();

export function startDepsPrep(
  db: Queryable,
  runId: string,
  main: string,
  copy: string,
  options: DepsOptions,
  report: (prep: DepsPrep) => Promise<void> = async () => undefined,
): void {
  const entry: Pending = { waitedMs: 0, promise: Promise.resolve(null) };
  entry.promise = prepareDependencies(main, copy, options)
    .catch(() => null)
    .then(async (prep) => {
      if (prep) {
        await saveDeps(db, runId, { ...prep, waitedMs: entry.waitedMs }).catch(() => null);
        await report(prep).catch(() => undefined);
      }
      return prep;
    });
  pending.set(runId, entry);
}

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
