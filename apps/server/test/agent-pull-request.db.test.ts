import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchesForConversation } from '../src/persistence/pr-watches.ts';
import { runTask } from '../src/persistence/tasks.ts';
import { createTaskRecorder } from '../src/workflow/task-recorder.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const URL_ONE = 'https://github.com/acme/widgets/pull/7';

async function recorderFor(runId: string) {
  const recorder = createTaskRecorder(t.db, runId, 'Tidy the notes', async () => null);
  await recorder.observe({ kind: 'step_started', name: 'gh pr create', tool: true });
  return recorder;
}

async function audited(runId: string) {
  const { rows } = await t.db.query<{ method: string; payload: Record<string, unknown> }>(
    `SELECT method, payload FROM run_protocol_log WHERE run_id = $1 AND method = 'ship/agent_pr'`,
    [runId],
  );
  return rows;
}

describe('a pull request the agent opened itself', () => {
  it('is linked to the task and audited once, however often its link is seen', async () => {
    const { runId } = await startChat(t, 'Tidy the notes and open a PR');
    const recorder = await recorderFor(runId);
    const link = { kind: 'link', url: URL_ONE, title: 'acme/widgets#7', source: 'tool_output' };
    await recorder.observe(link as never);
    await recorder.observe(link as never);
    await recorder.replied(`Opened ${URL_ONE}`);
    const task = await runTask(t.db, runId);
    const { rows } = await t.db.query<{ url: string; kind: string; source: string }>(
      'SELECT url, kind, source FROM task_links WHERE task_id = $1',
      [task!.taskId],
    );
    expect(rows).toEqual([{ url: URL_ONE, kind: 'pr', source: 'tool_output' }]);
    const entries = await audited(runId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.payload).toMatchObject({
      outcome: 'opened',
      via: 'agent_command',
      url: URL_ONE,
      number: 7,
      repo: 'acme/widgets',
    });
  });

  it('is not watched when the chat has no branch of its own to follow up on', async () => {
    const { conversationId, runId } = await startChat(t, 'Open a PR');
    const recorder = await recorderFor(runId);
    await recorder.observe({
      kind: 'link',
      url: URL_ONE,
      title: 'acme/widgets#7',
      source: 'tool_output',
    } as never);
    expect(await watchesForConversation(t.db, t.workspaceId, conversationId)).toEqual([]);
    expect((await audited(runId))[0]!.payload).toMatchObject({ watched: false, branch: null });
  });
});
