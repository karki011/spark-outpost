import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { modeForLegacy } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Provider, ProviderOutput, ProviderTurn } from '../src/providers/provider.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { changesOf, gitRepo, removeRepo } from './turn-support.ts';

let t: TestDb;
let root: string;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await removeRepo(root);
});

function start(provider: Provider) {
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
  });
}

async function sendDo(): Promise<string> {
  const { conversationId } = await linkedConversation(t, root);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Change the notes' },
    {
      provider: 'scripted',
      permission: 'do',
      agentMode: modeForLegacy('claude', 'do', 'hands-off'),
      level: 'hands-off',
    },
  );
  return sent.run.id;
}

async function snapshotRoot(runId: string): Promise<string | null> {
  const { rows } = await t.db.query<{ root: string | null }>(
    'SELECT snapshot_root AS root FROM runs WHERE id = $1 AND snapshot_kind IS NOT NULL',
    [runId],
  );
  return rows[0]?.root ?? null;
}

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  });
}

interface Seen {
  runs: number;
  snapshotRoot: string | null;
  turn: ProviderTurn | null;
}

function editingProvider(seen: Seen): Provider {
  return {
    name: 'scripted',
    async *run(turn): AsyncGenerator<ProviderOutput> {
      seen.runs += 1;
      seen.turn = turn;
      const runId = turn.sparkScope?.runId;
      const workRoot = turn.projectRoots?.[0];
      seen.snapshotRoot = runId ? await snapshotRoot(runId) : null;
      if (workRoot) await writeFile(join(workRoot, 'notes.txt'), 'changed\n');
      yield { kind: 'text_delta', delta: 'Done' };
    },
  };
}

describe('what a Do turn has ready before the agent runs', () => {
  it('has taken the snapshot and prepared every part of the turn', async () => {
    const seen: Seen = { runs: 0, snapshotRoot: null, turn: null };
    start(editingProvider(seen));
    const runId = await sendDo();
    expect((await settled(runId)).status).toBe('succeeded');

    expect(seen.runs).toBe(1);
    const workRoot = seen.turn?.projectRoots?.[0];
    expect(workRoot).toBeTruthy();
    expect(seen.snapshotRoot).toBe(workRoot);
    expect(seen.turn?.approvals).toBeDefined();
    expect(seen.turn?.spark).toBeDefined();
    expect(seen.turn?.sparkScope?.commands).toBeDefined();
    const changes = await changesOf(t, runId);
    expect(changes.files.map((file) => file.path)).toEqual(['notes.txt']);
  });

  it('prepares nothing and never calls the agent when the turn was stopped first', async () => {
    const seen: Seen = { runs: 0, snapshotRoot: null, turn: null };
    const runId = await sendDo();
    await t.db.query('UPDATE runs SET cancel_requested_at = now() WHERE id = $1', [runId]);
    start(editingProvider(seen));
    const run = await settled(runId);

    expect(run.status).toBe('cancelled');
    expect(seen.runs).toBe(0);
    expect(await snapshotRoot(runId)).toBeNull();
    const { rowCount } = await t.db.query(
      'SELECT 1 FROM provider_sessions WHERE conversation_id = $1',
      [run.conversationId],
    );
    expect(rowCount).toBe(0);
  });

  it('fails the turn with the same message when the agent is not available', async () => {
    start({
      name: 'another',
      async *run(): AsyncGenerator<ProviderOutput> {
        yield { kind: 'text_delta', delta: 'never' };
      },
    });
    const runId = await sendDo();
    const run = await settled(runId);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('Provider "scripted" is not available.');
    expect(await snapshotRoot(runId)).toBeNull();
  });
});
