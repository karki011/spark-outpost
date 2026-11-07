import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { createObservedEdits } from './observed-edits.ts';

let folder: string;

beforeEach(async () => {
  folder = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-observed-edits-')));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

interface Saved {
  path: string;
  content: Buffer | null;
}

function filesRun(root: string) {
  const saved: Saved[] = [];
  const db = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes('INSERT INTO run_file_backups')) {
        saved.push({ path: values[1] as string, content: values[3] as Buffer | null });
        return { rows: [] };
      }
      return {
        rows: [
          { snapshot_kind: 'files', snapshot_ref: null, snapshot_root: root, status: 'running' },
        ],
      };
    },
  } as unknown as Db;
  return { db, saved };
}

function editOf(target: string) {
  return { kind: 'file_focus', path: target, line: null, limit: null, action: 'edit' } as const;
}

it.skipIf(process.platform === 'win32')(
  'never reads or backs up a named pipe or a device',
  async () => {
    const pipe = path.join(folder, 'pipe');
    execFileSync('mkfifo', [pipe]);
    const { db, saved } = filesRun(folder);
    const edits = createObservedEdits({ db, workspaceId: 'w', runId: 'r', root: folder });
    edits.see(editOf(pipe));
    edits.see(editOf('/dev/zero'));
    await edits.settled();
    expect(saved).toEqual([]);
  },
  5_000,
);

it('keeps the text from before a relative-path edit written at once', async () => {
  writeFileSync(path.join(folder, 'notes.txt'), 'draft\n');
  const { db, saved } = filesRun(folder);
  const edits = createObservedEdits({ db, workspaceId: 'w', runId: 'r', root: folder });
  edits.see(editOf('notes.txt'));
  writeFileSync(path.join(folder, 'notes.txt'), 'final\n');
  await edits.settled();
  expect(saved.map((backup) => [backup.path, backup.content?.toString()])).toEqual([
    [path.join(folder, 'notes.txt'), 'draft\n'],
  ]);
});
