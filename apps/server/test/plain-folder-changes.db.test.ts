import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_PULL_REQUEST } from '../src/orchestration/no-pull-request.ts';
import { listBackups } from '../src/persistence/run-snapshots.ts';
import { revertRun } from '../src/projects/run-changes.ts';
import type { Provider, ProviderOutput } from '../src/providers/provider.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, type TestDb } from './support.ts';
import { changesOf, driveToEnd, openChat, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let folder: string;
let worker: Worker;

function editing(files: Record<string, string>): Provider {
  return {
    name: 'claude',
    async *run(turn) {
      const root = turn.projectRoots?.[0] ?? '';
      for (const [name, content] of Object.entries(files)) {
        const target = path.join(root, name);
        const seen: ProviderOutput = {
          kind: 'file_focus',
          path: target,
          line: null,
          limit: null,
          action: 'edit',
        };
        turn.observe?.(seen);
        yield seen;
        await writeFile(target, content);
      }
      yield { kind: 'text_delta', delta: 'Edited the notes.' };
    },
  };
}

beforeEach(async () => {
  t = await createTestDb();
  folder = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-plain-folder-')));
  await writeFile(path.join(folder, 'notes.txt'), 'draft\n');
  await connectAgents(t);
  const agent = editing({ 'notes.txt': 'final\n', 'new.txt': 'added\n' });
  worker = startTurnWorker(t, { providers: new Map([[agent.name, agent]]) });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await rm(folder, { recursive: true, force: true });
});

describe('an edit the agent made without asking, in a folder that is not a git repository', () => {
  it('is kept with its record, can be reverted, and gets the one line', async () => {
    const conversationId = await openChat(t, { root: folder, level: 'full-auto' });
    const runId = await sendMessage(t, conversationId, 'Finish the notes.', {
      permission: 'do',
      agentMode: 'bypassPermissions',
      level: 'full-auto',
    });
    const { run, asked } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(asked).toEqual([]);
    expect((await changesOf(t, runId)).files).toEqual([
      { path: 'new.txt', change: 'added' },
      { path: 'notes.txt', change: 'modified' },
    ]);
    expect(await listBackups(t.db, runId)).toHaveLength(2);
    const replies = await repliesOf(t, runId);
    expect(replies.join('\n').match(/No pull request/g)).toHaveLength(1);
    expect(replies.join('\n')).toContain(NO_PULL_REQUEST.notGit);
    const { rows } = await t.db.query<{ kept: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM run_events WHERE run_id = $1
         AND payload::text LIKE '%Changes kept%') AS kept`,
      [runId],
    );
    expect(rows[0]?.kept).toBe(true);

    await revertRun(t.db, t.workspaceId, runId);
    expect(await readFile(path.join(folder, 'notes.txt'), 'utf8')).toBe('draft\n');
    await expect(readFile(path.join(folder, 'new.txt'), 'utf8')).rejects.toThrow();
  });
});
