import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APPROVAL_REQUESTED,
  CHECKPOINT_OPTION,
  type TicketSummary,
} from '@spark-outpost/contracts';
import { chatTickets } from '../src/persistence/chat-tickets.ts';
import { saveTicketConnection } from '../src/persistence/ticket-connections.ts';
import { cacheTickets, ticketsForTask } from '../src/persistence/tickets.ts';
import { revertRun } from '../src/projects/run-changes.ts';
import { KEPT_RECORD_TITLE } from '../src/workflow/kept-record-writer.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, type TestDb } from './support.ts';
import {
  cardsOf,
  changesOf,
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const ticket = (key: string, title: string): TicketSummary => ({
  source: 'linear',
  key,
  title,
  status: 'todo',
  statusName: 'Todo',
  url: `https://linear.app/acme/issue/${key}`,
  updatedAt: '2026-09-27T09:00:00.000Z',
  project: 'ENG',
  priority: null,
  sprint: null,
  priorityRank: 0,
  assignedTo: null,
  labels: [],
  dueDate: null,
  doneAt: null,
  reporter: null,
  createdAt: null,
});

let t: TestDb;
let root: string;
let worker: Worker;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectAgents(t);
  worker = startTurnWorker(t, {});
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
});

async function turn(conversationId: string, text: string) {
  const runId = await sendMessage(t, conversationId, text, { permission: 'do' });
  const { run } = await driveToEnd(t, conversationId, runId);
  expect(run.status).toBe('succeeded');
  return runId;
}

interface KeptRow {
  id: string;
  run_id: string;
  title: string;
  status: string;
  decided_by: string;
  decision_option_id: string;
  payload: { checkpoint: Record<string, unknown> };
}

async function keptRecords(conversationId: string): Promise<KeptRow[]> {
  const { rows } = await t.db.query<KeptRow>(
    `SELECT a.id, a.run_id, a.title, a.status, a.decided_by, a.decision_option_id, a.payload
     FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = 'accept' ORDER BY a.created_at`,
    [conversationId],
  );
  return rows;
}

async function shownInRun(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ id: string }>(
    `SELECT payload->'value'->>'id' AS id FROM run_events
     WHERE run_id = $1 AND type = 'CUSTOM' AND payload->>'name' = $2 ORDER BY seq`,
    [runId, APPROVAL_REQUESTED],
  );
  return rows.map((row) => row.id);
}

describe('the record of kept changes on a chat turn', { timeout: 60_000 }, () => {
  it('records the files a turn changed, without checks or findings', async () => {
    const conversationId = await openChat(t, { root });
    const runId = await turn(conversationId, `Edit it #fswrite ${join(root, 'notes.txt')}`);

    const records = await keptRecords(conversationId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      title: KEPT_RECORD_TITLE,
      status: 'allowed',
      decided_by: 'level',
      decision_option_id: CHECKPOINT_OPTION.keep,
    });
    expect(await shownInRun(runId)).toEqual([records[0]!.id]);
    expect(await cardsOf(t, conversationId)).toEqual([]);
    expect(records[0]!.payload.checkpoint).toMatchObject({
      files: [{ path: 'notes.txt', change: 'modified' }],
      lines: { added: 1, removed: 1 },
      keptBy: 'hands-off',
      keptAt: { branch: expect.any(String), commit: null },
      checks: null,
      keptNote: null,
      laws: [],
    });
  });

  it('reverts the kept changes and marks the run reverted', async () => {
    const conversationId = await openChat(t, { root });
    const file = join(root, 'notes.txt');
    const runId = await turn(conversationId, `Edit it #fswrite ${file}`);
    expect(await readFile(file, 'utf8')).toBe('x');
    expect(await changesOf(t, runId)).toMatchObject({ revertible: true, revertedAt: null });

    const reverted = await revertRun(t.db, t.workspaceId, runId);

    expect(reverted.restored).toEqual([{ path: 'notes.txt', change: 'modified' }]);
    expect(await readFile(file, 'utf8')).toBe('start\n');
    expect(await changesOf(t, runId)).toMatchObject({
      revertible: false,
      revertedAt: reverted.revertedAt,
    });
    expect(await keptRecords(conversationId)).toHaveLength(1);
  });

  it('writes no record for a turn that changed nothing', async () => {
    const inProject = await openChat(t, { root });
    await turn(inProject, 'Hello');
    const noProject = await openChat(t);
    await turn(noProject, 'Hello');

    expect(await keptRecords(inProject)).toEqual([]);
    expect(await keptRecords(noProject)).toEqual([]);
  });
});

describe('the ticket a chat turn works on', { timeout: 60_000 }, () => {
  const linkedKeys = async (conversationId: string) =>
    (await chatTickets(t.db, conversationId)).linked.map((entry) => entry.key);

  beforeEach(async () => {
    await saveTicketConnection(t.db, t.workspaceId, {
      source: 'linear',
      apiUrl: 'https://linear.test/graphql',
      email: null,
      account: 'Alex',
      accountId: 'user-1',
    });
    await cacheTickets(t.db, t.workspaceId, [
      ticket('ENG-12', 'Login fails after a password reset'),
      ticket('ENG-13', 'Signup form loses the email'),
    ]);
  });

  it('is linked when files changed, once, to the chat and its task', async () => {
    const conversationId = await openChat(t, { root });
    const file = join(root, 'notes.txt');

    await turn(conversationId, 'Fix ENG-12');
    expect(await linkedKeys(conversationId)).toEqual([]);

    await turn(conversationId, `Fix ENG-12 #fswrite ${file}`);
    expect(await linkedKeys(conversationId)).toEqual(['ENG-12']);

    await turn(conversationId, `Fix ENG-13 #fswrite ${join(root, 'more.txt')}`);
    expect(await linkedKeys(conversationId)).toEqual(['ENG-12']);

    const { rows } = await t.db.query<{ id: string }>(
      'SELECT id FROM tasks WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [conversationId],
    );
    const onTask = await ticketsForTask(t.db, rows[0]!.id);
    expect(onTask.map((entry) => entry.key)).toEqual(['ENG-12']);
  });
});
