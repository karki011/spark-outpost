import path from 'node:path';
import type { Db } from '../persistence/db.ts';
import { getSnapshot, type RunSnapshot } from '../persistence/run-snapshots.ts';
import { readBefore, readBeforeNow, type FileBefore } from '../projects/file-before.ts';
import { backupBeforeEdit } from '../projects/run-changes.ts';
import type { ProviderOutput } from '../providers/provider.ts';

const READ_AT_ONCE_BYTES = 8 * 1024 * 1024;

function captureNow(target: string): Promise<FileBefore> | null {
  try {
    const before = readBeforeNow(target, READ_AT_ONCE_BYTES);
    return before === 'too-large' ? null : Promise.resolve(before);
  } catch (error) {
    return Promise.reject(error);
  }
}

export interface ObservedEdits {
  see(output: ProviderOutput): void;
  settled(): Promise<void>;
}

export interface ObservedEditsOptions {
  db: Db;
  workspaceId: string;
  runId: string;
  root?: string | null | undefined;
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
  const backUp = async (
    target: string,
    early: { file: string; before: Promise<FileBefore> } | null,
  ) => {
    const taken = await snapshot();
    if (taken?.kind !== 'files') return;
    const file = path.resolve(taken.root, target);
    const read = early?.file === file ? () => early.before : readBefore;
    for (const id of runIds) await backupBeforeEdit(db, id, taken, [file], read);
  };
  const capture = (target: string) => {
    const file = options.root ? path.resolve(options.root, target) : target;
    if (!path.isAbsolute(file)) return null;
    const before = captureNow(file);
    if (!before) return null;
    before.catch(() => undefined);
    return { file, before };
  };
  return {
    see(output) {
      if (output.kind !== 'file_focus' || output.action !== 'edit') return;
      if (started.has(output.path)) return;
      started.add(output.path);
      pending.push(
        backUp(output.path, capture(output.path)).catch((error: unknown) =>
          console.error('Could not record a file the agent edited', error),
        ),
      );
    },
    async settled() {
      await Promise.all(pending);
    },
  };
}
