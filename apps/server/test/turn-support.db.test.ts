import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { standInTurn } from './turn-stand-in.ts';
import {
  auditOf,
  cardsOf,
  changesOf,
  driveToEnd,
  gitRepo,
  leaveCards,
  openChat,
  removeRepo,
  repliesOf,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let worker: Worker;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectAgents(t);
  worker = startTurnWorker(t, { runTurn: standInTurn });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(root);
});

describe('turn support', () => {
  it('sends a message in a chat without a project and reads the reply', async () => {
    const conversationId = await openChat(t);
    const runId = await sendMessage(t, conversationId, 'Hello');

    const { run, asked } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(asked).toEqual([]);
    const replies = await repliesOf(t, runId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/^Hello there/);
    expect(await loadOrchestration(t.db, runId)).toBeNull();
  });

  it('answers the card a turn raises and reads what the agent was told', async () => {
    const conversationId = await openChat(t, { root });
    const runId = await sendMessage(t, conversationId, 'Run it #command', { permission: 'do' });

    const { run, asked } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(asked).toHaveLength(1);
    expect(await cardsOf(t, conversationId)).toMatchObject([
      { id: asked[0]!.id, status: 'allowed' },
    ]);
    expect(await repliesOf(t, runId)).toEqual(['permission=yes']);
  });

  it('reads the files a changing turn changed', async () => {
    const conversationId = await openChat(t, { root });
    const file = join(root, 'notes.txt');
    const runId = await sendMessage(t, conversationId, `Edit it #fswrite ${file}`, {
      permission: 'do',
    });

    const { run } = await driveToEnd(t, conversationId, runId);

    expect(run.status).toBe('succeeded');
    expect(await readFile(file, 'utf8')).toBe('x');
    expect(await changesOf(t, runId)).toMatchObject({
      revertible: true,
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
  });

  it('leaves a card pending when the answerer declines, until the turn is stopped', async () => {
    const conversationId = await openChat(t, { root });
    const runId = await sendMessage(t, conversationId, 'Run it #command', { permission: 'do' });

    await eventually(async () => (await cardsOf(t, conversationId)).length > 0);
    await expect(driveToEnd(t, conversationId, runId, leaveCards, 300)).rejects.toThrow(
      'Condition not met',
    );
    expect(await cardsOf(t, conversationId)).toMatchObject([{ status: 'pending' }]);

    await requestCancel(t.db, runId);
    const { run } = await driveToEnd(t, conversationId, runId, leaveCards);
    expect(run.status).toBe('cancelled');
  });

  it('reads the audit of a turn', async () => {
    const conversationId = await openChat(t, { root });
    const runId = await sendMessage(t, conversationId, 'Hello', { provider: 'codex' });

    await driveToEnd(t, conversationId, runId);

    const methods = (await auditOf(t, runId)).map((entry) => entry.method);
    expect(methods).toContain('session/prompt');
    expect(methods).toContain('session/update');
  });
});
