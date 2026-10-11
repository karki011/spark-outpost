import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { recordSessionSettings } from '../src/workflow/run-metadata.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function builderRun(model: string, modelLabel: string | null, label: string) {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Add clamp.' },
    { provider: 'claude' },
  );
  await t.db.query(
    `UPDATE runs SET role = 'builder', model = $2, agent_label = $3, route = $4 WHERE id = $1`,
    [sent.run.id, model, label, JSON.stringify(modelLabel ? { modelLabel } : {})],
  );
  return sent.run.id;
}

async function ranOn(runId: string, model: string | null) {
  await recordSessionSettings(t.db, runId, {
    kind: 'session_settings',
    model,
    effort: 'medium',
    mode: 'auto',
  });
  const { rows } = await t.db.query<{ agent_label: string; used_model: string | null }>(
    'SELECT agent_label, used_model FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0];
}

describe("a run's label after the agent reports the model it ran on", () => {
  it('names the model that ran when it is not the chosen one', async () => {
    const runId = await builderRun('sonnet', 'Sonnet 5', 'Bolt · Builder · Sonnet 5 · medium');
    expect(await ranOn(runId, 'claude-opus-5-5')).toEqual({
      agent_label: 'Bolt · Builder · Opus 5.5 · medium',
      used_model: 'claude-opus-5-5',
    });
  });

  it('replaces a raw model id with the name on its card', async () => {
    const runId = await builderRun('opus', null, 'Bolt · Builder · opus · medium');
    expect((await ranOn(runId, 'claude-opus-5-5'))?.agent_label).toBe(
      'Bolt · Builder · Opus 5.5 · medium',
    );
  });

  it('keeps the label when the chosen model ran, or an alias or a model with no card is reported', async () => {
    const same = await builderRun('sonnet', 'Sonnet 5', 'Bolt · Builder · Sonnet 5 · medium');
    expect((await ranOn(same, 'claude-sonnet-5'))?.agent_label).toBe(
      'Bolt · Builder · Sonnet 5 · medium',
    );
    for (const alias of ['default', 'opus', 'sonnet']) {
      const run = await builderRun('sonnet', 'Sonnet 5', 'Bolt · Builder · Sonnet 5 · medium');
      expect((await ranOn(run, alias))?.agent_label).toBe('Bolt · Builder · Sonnet 5 · medium');
    }
  });

  it('gives the chat the model that ran beside the one it was pinned to', async () => {
    const runId = await builderRun('sonnet', null, 'Claude');
    const { rows } = await t.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM runs WHERE id = $1',
      [runId],
    );
    const runsOf = async () =>
      (await getConversationDetail(t.db, rows[0]!.conversation_id))!.runs.map((run) => ({
        model: run.model,
        usedModel: run.usedModel,
      }));
    expect(await runsOf()).toEqual([{ model: 'sonnet', usedModel: null }]);
    await ranOn(runId, 'claude-sonnet-5-5');
    expect(await runsOf()).toEqual([{ model: 'sonnet', usedModel: 'claude-sonnet-5-5' }]);
  });
});
