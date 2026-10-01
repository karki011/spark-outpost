import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatUpdateSchema } from '@spark-outpost/contracts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { insertApproval } from '../src/persistence/approvals.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { createTestApp, jsonResponse, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let jevBodies: Record<string, unknown>[];

beforeEach(async () => {
  t = await createTestDb();
  jevBodies = [];
});

afterEach(async () => {
  await t.cleanup();
});

function jevFetch(answers: Record<string, unknown>, status = 200): typeof fetch {
  return async (input, init) => {
    expect(String(input)).toBe('https://typesafe.test/v1/systemone');
    jevBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (status !== 200) return jsonResponse(status, { error: 'down' });
    return jsonResponse(200, {
      model: 'jev-1.13.0',
      answers,
      usage: { input_tokens: 800, output_tokens: 0 },
    });
  };
}

const choice = (value: string, confidence = 0.9) => ({
  type: 'choice',
  choice: value,
  probabilities: { [value]: confidence },
  confidence,
});

async function connectJev() {
  await t.db.query(
    `INSERT INTO advisor_connections
       (workspace_id, advisor, method, detail, models, model, verified_at)
     VALUES ($1, 'jev', 'api_key', '…test', '[]', 'jev-latest', now())`,
    [t.workspaceId],
  );
}

async function runningChat(title = 'Fix image uploads') {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  await t.db.query('UPDATE conversations SET title = $2 WHERE id = $1', [conversation.id, title]);
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: title },
    { provider: 'fake', permission: 'ask', agentMode: null, level: 'hands-off' },
  );
  await t.db.query(`UPDATE runs SET status = 'running', started_at = now() WHERE id = $1`, [
    sent.run.id,
  ]);
  return { conversationId: conversation.id, runId: sent.run.id };
}

async function counts() {
  const { rows } = await t.db.query<{ messages: number; runs: number; events: number }>(
    `SELECT (SELECT count(*) FROM messages)::int AS messages,
       (SELECT count(*) FROM runs)::int AS runs,
       (SELECT count(*) FROM run_events)::int AS events`,
  );
  return rows[0]!;
}

async function updateAdvice(runId: string) {
  const { rows } = await t.db.query<{ jev_status: string; body: Record<string, unknown> }>(
    `SELECT jev_status, body FROM run_advice WHERE run_id = $1 AND purpose = 'chat_update'`,
    [runId],
  );
  return rows;
}

function client(fetch?: typeof fetch) {
  const secrets = memorySecretStore({ jev: 'fake-jev-key' });
  return localClient(createTestApp(t, { secrets, ...(fetch ? { fetch } : {}) }));
}

describe('POST /api/conversations/:id/update', () => {
  it('lets Jev pick the headline and next step, records the call, and never touches the agent', async () => {
    await connectJev();
    const { conversationId, runId } = await runningChat();
    const before = await counts();

    const response = await client(
      jevFetch({ update_state: choice('stuck'), update_next: choice('run_checks') }),
    ).send('post', `/api/conversations/${conversationId}/update`);

    expect(response.status).toBe(200);
    const update = chatUpdateSchema.parse(response.body);
    expect(update.by).toBe('jev');
    expect(update.lines[0]).toMatch(/^Seems stuck\./);
    expect(update.lines.at(-1)).toBe('Next: run the project checks.');
    expect(update.lines.join(' ')).toContain('No files changed yet; checks haven’t run yet');
    expect(jevBodies).toHaveLength(1);
    expect(Object.keys(jevBodies[0]!.questions as object)).toEqual(['update_state', 'update_next']);

    expect(await counts()).toEqual(before);
    const advice = await updateAdvice(runId);
    expect(advice).toHaveLength(1);
    expect(advice[0]!.jev_status).toBe('answered');
    expect(advice[0]!.body).toMatchObject({ applied: 'jev', jevModel: 'jev-1.13.0' });
    const { rows } = await t.db.query(`SELECT 1 FROM run_advice WHERE purpose = 'intake'`);
    expect(rows).toHaveLength(0);
  });

  it('falls back to the rules when Jev is not connected', async () => {
    const { conversationId, runId } = await runningChat();
    const response = await client().send('post', `/api/conversations/${conversationId}/update`);
    const update = chatUpdateSchema.parse(response.body);
    expect(update.by).toBe('rules');
    expect(update.lines[0]).toMatch(/^On track\./);
    expect(update.lines.at(-1)).toBe('Next: finish the current step.');
    expect((await updateAdvice(runId))[0]!.jev_status).toBe('not_connected');
  });

  it('falls back to the rules when Jev fails or is unsure', async () => {
    await connectJev();
    const { conversationId, runId } = await runningChat();
    const failed = await client(jevFetch({}, 500)).send(
      'post',
      `/api/conversations/${conversationId}/update`,
    );
    expect(chatUpdateSchema.parse(failed.body).by).toBe('rules');
    const unsure = await client(jevFetch({ update_state: choice('stuck', 0.3) })).send(
      'post',
      `/api/conversations/${conversationId}/update`,
    );
    expect(chatUpdateSchema.parse(unsure.body).lines[0]).toMatch(/^On track\./);
    const statuses = (await updateAdvice(runId)).map((row) => row.jev_status).sort();
    expect(statuses).toEqual(['answered', 'failed']);
  });

  it('names the pending command without asking Jev when there is nothing to choose', async () => {
    await connectJev();
    const { conversationId, runId } = await runningChat('Add dark mode toggle');
    await t.db.query(`UPDATE runs SET status = 'awaiting_approval' WHERE id = $1`, [runId]);
    await insertApproval(t.db, {
      runId,
      toolCallId: 'c1',
      rpcId: null,
      kind: 'execute',
      title: 'pnpm add -D vitest',
      payload: { command: 'pnpm add -D vitest', cwd: null, paths: [], diffs: [], truncated: false },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
      ],
    });

    const response = await client(jevFetch({})).send(
      'post',
      `/api/conversations/${conversationId}/update`,
    );
    const update = chatUpdateSchema.parse(response.body);
    expect(update.lines[0]).toMatch(/^Waiting on you\./);
    expect(update.lines.at(-1)).toBe('Next: your answer on “pnpm add -D vitest”.');
    expect(jevBodies).toHaveLength(0);
    expect((await updateAdvice(runId))[0]!.jev_status).toBe('not_asked');
  });

  it('answers for a chat that has not started and 404s for an unknown one', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const api = client();
    const fresh = await api.send('post', `/api/conversations/${conversation.id}/update`);
    expect(chatUpdateSchema.parse(fresh.body).lines).toEqual([
      'On track. Nothing has started yet.',
      'Next: send a message to start.',
    ]);
    const missing = await api.send('post', `/api/conversations/${randomUUID()}/update`);
    expect(missing.status).toBe(404);
  });
});
