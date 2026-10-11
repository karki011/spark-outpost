import path from 'node:path';
import type { Db } from '../persistence/db.ts';
import { getSnapshot, type RunSnapshot } from '../persistence/run-snapshots.ts';
import { backupBeforeEdit } from '../projects/run-changes.ts';
import type { ProviderOutput } from '../providers/provider.ts';

export interface ObservedEdits {
  see(output: ProviderOutput): void;
  settled(): Promise<void>;
}

export interface ObservedEditsOptions {
  db: Db;
  workspaceId: string;
  runId: string;
  alsoFor?: string | undefined;
}

export function createObservedEdits(options: ObservedEditsOptions): ObservedEdits {
  const { db, workspaceId, runId } = options;
  const runIds = options.alsoFor ? [runId, options.alsoFor] : [runId];
  const started = new Set<string>();
  const pending: Promise<void>[] = [];
  let loaded: Promise<RunSnapshot | null> | null = null;
  const snapshot = () => {
    loaded ??= getSnapshot(db, workspaceId, runId).then((state) => state?.snapshot ?? null);
    return loaded;
  };
  const backUp = async (target: string) => {
    const taken = await snapshot();
    if (taken?.kind !== 'files') return;
    const file = path.resolve(taken.root, target);
    for (const id of runIds) await backupBeforeEdit(db, id, taken, [file]);
  };
  return {
    see(output) {
      if (output.kind !== 'file_focus' || output.action !== 'edit') return;
      if (started.has(output.path)) return;
      started.add(output.path);
      pending.push(
        backUp(output.path).catch((error: unknown) =>
          console.error('Could not record a file the agent edited', error),
        ),
      );
    },
    async settled() {
      await Promise.all(pending);
    },
  };
}
