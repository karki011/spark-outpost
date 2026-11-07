import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { createObservedEdits } from './observed-edits.ts';

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'spark-observed-edits-'));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const noRun = { query: async () => ({ rows: [] }) } as unknown as Db;

it.skipIf(process.platform === 'win32')(
  'never reads a named pipe or a device while noting an edit',
  async () => {
    const pipe = path.join(folder, 'pipe');
    execFileSync('mkfifo', [pipe]);
    const edits = createObservedEdits({ db: noRun, workspaceId: 'w', runId: 'r' });
    for (const target of [pipe, '/dev/zero']) {
      edits.see({ kind: 'file_focus', path: target, line: null, limit: null, action: 'edit' });
    }
    await expect(edits.settled()).resolves.toBeUndefined();
  },
  5_000,
);
