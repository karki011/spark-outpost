import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unnotedReverts } from '../src/persistence/file-reverts.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { noteRevertedFiles } from '../src/workflow/revert-note.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { revert, runFacts, runTurn, scriptedAgent, type Ops } from './file-revert-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let repo: string;
let worker: Worker;
let queue: Ops[];

beforeEach(async () => {
  t = await createTestDb();
  repo = await gitRepo();
  queue = [];
  await connectAgents(t);
  const agent = scriptedAgent(queue);
  worker = startTurnWorker(t, { providers: new Map([[agent.name, agent]]) });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(repo);
});

async function nextTurnInput(conversationId: string, text: string) {
  const runId = await sendMessage(t, conversationId, text, {
    permission: 'do',
    agentMode: 'bypassPermissions',
  });
  return loadRunInput(t.db, runId);
}

describe('telling the agent about a file revert on the next turn', { timeout: 60_000 }, () => {
  it('names the reverted paths, never their contents, until a turn reaches the agent', async () => {
    const conversationId = await openChat(t, { root: repo });
    queue.push({ write: { 'notes.txt': 'agent secret value\n', 'new.txt': 'new\n' } });
    const runId = await runTurn(t, conversationId);
    const { taskId } = await runFacts(t, runId);
    await revert(t, taskId, runId, 'notes.txt');
    await worker.stop();

    const command = await nextTurnInput(conversationId, '/compact');
    expect((await noteRevertedFiles(t.db, command)).input).toBe(command);

    const stopped = await nextTurnInput(conversationId, 'Carry on.');
    const note =
      'The user reverted these files to how they were before run 1: notes.txt.\n' +
      'Re-read them before editing.\n\nCarry on.';
    expect((await noteRevertedFiles(t.db, stopped)).input.followUp).toBe(note);
    const again = await noteRevertedFiles(t.db, stopped);
    expect(again.input.followUp).toBe(note);
    expect(again.input.followUp).not.toContain('agent secret value');

    await again.delivered();
    expect((await noteRevertedFiles(t.db, stopped)).input).toBe(stopped);
  });

  it('is marked delivered once a turn the agent answered succeeds', async () => {
    const conversationId = await openChat(t, { root: repo });
    queue.push({ write: { 'notes.txt': 'agent notes\n' } });
    const runId = await runTurn(t, conversationId);
    const { taskId } = await runFacts(t, runId);
    await revert(t, taskId, runId, 'notes.txt');
    expect(await unnotedReverts(t.db, conversationId)).toHaveLength(1);

    await runTurn(t, conversationId);

    expect(await unnotedReverts(t.db, conversationId)).toEqual([]);
  });
});
