import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { usageSummary } from '../src/persistence/usage.ts';
import { recordTokens, recordUsage } from '../src/workflow/run-metadata.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function reply(
  conversationId: string,
  provider: string,
  usage: { cost: number | null; input: number; output: number; context: number },
) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: `ask ${provider}` },
    { provider },
  );
  const runId = sent.run.id;
  await recordUsage(t.db, runId, {
    kind: 'usage',
    contextUsed: usage.context,
    contextSize: 100_000,
    costUsd: usage.cost,
  });
  await recordTokens(t.db, runId, {
    kind: 'tokens',
    tokens: {
      input: usage.input,
      output: usage.output,
      total: usage.input + usage.output,
      cachedRead: null,
      cachedWrite: null,
      thought: null,
    },
  });
  return runId;
}

describe('usage totals', () => {
  it('keeps the latest cumulative cost for a run and stores its tokens', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const runId = await reply(conversation.id, 'claude', {
      cost: 0.01,
      input: 100,
      output: 50,
      context: 1000,
    });
    await recordUsage(t.db, runId, {
      kind: 'usage',
      contextUsed: 2000,
      contextSize: 100_000,
      costUsd: 0.03,
    });
    await recordUsage(t.db, runId, {
      kind: 'usage',
      contextUsed: 2500,
      contextSize: 100_000,
      costUsd: null,
    });

    const detail = await getConversationDetail(t.db, conversation.id);
    expect(detail?.runs[0]?.usage).toEqual({
      contextUsed: 2500,
      contextSize: 100_000,
      costUsd: 0.03,
      costSource: 'reported',
      tokens: {
        input: 100,
        output: 50,
        total: 150,
        cachedRead: null,
        cachedWrite: null,
        thought: null,
      },
    });
  });

  it('totals a chat that used more than one provider', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    await reply(conversation.id, 'claude', { cost: 0.02, input: 1000, output: 200, context: 5000 });
    await reply(conversation.id, 'codex', { cost: null, input: 3000, output: 400, context: 9000 });
    await reply(conversation.id, 'claude', { cost: 0.01, input: 1500, output: 300, context: 8000 });

    const detail = await getConversationDetail(t.db, conversation.id);
    const totals = detail!.usageTotals;
    expect(totals.costUsd).toBeCloseTo(0.03);
    expect(totals.totalTokens).toBe(6400);
    expect(totals.byProvider).toEqual([
      expect.objectContaining({
        provider: 'claude',
        runs: 2,
        inputTokens: 2500,
        outputTokens: 500,
        lastContextUsed: 8000,
        lastContextSize: 100_000,
      }),
      expect.objectContaining({
        provider: 'codex',
        runs: 1,
        costUsd: null,
        inputTokens: 3000,
        lastContextUsed: 9000,
      }),
    ]);
  });

  it('summarizes the workspace per provider for all time and the last 30 days', async () => {
    const first = await createConversation(t.db, t.workspaceId, randomUUID());
    const second = await createConversation(t.db, t.workspaceId, randomUUID());
    const old = await reply(first.id, 'claude', { cost: 0.5, input: 10, output: 10, context: 1 });
    await reply(first.id, 'claude', { cost: 0.25, input: 20, output: 5, context: 1 });
    await reply(second.id, 'codex', { cost: null, input: 40, output: 8, context: 1 });
    await t.db.query(`UPDATE runs SET created_at = now() - interval '45 days' WHERE id = $1`, [
      old,
    ]);

    const summary = await usageSummary(t.db, t.workspaceId);
    expect(summary.allTime).toEqual([
      {
        provider: 'claude',
        runs: 2,
        costUsd: 0.75,
        costSource: 'reported',
        inputTokens: 30,
        outputTokens: 15,
        totalTokens: 45,
      },
      {
        provider: 'codex',
        runs: 1,
        costUsd: null,
        costSource: null,
        inputTokens: 40,
        outputTokens: 8,
        totalTokens: 48,
      },
    ]);
    expect(summary.last30Days[0]).toEqual({
      provider: 'claude',
      runs: 1,
      costUsd: 0.25,
      costSource: 'reported',
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
    });
    expect(summary.last30Days).toHaveLength(2);
  });

  it('labels estimated and mixed costs in chat and workspace totals', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    await reply(conversation.id, 'claude', { cost: 0.02, input: 10, output: 10, context: 1 });
    const estimated = await reply(conversation.id, 'codex', {
      cost: 0.01,
      input: 10,
      output: 10,
      context: 1,
    });
    await t.db.query(`UPDATE runs SET cost_source = 'estimated' WHERE id = $1`, [estimated]);

    const totals = (await getConversationDetail(t.db, conversation.id))!.usageTotals;
    expect(totals.costSource).toBe('mixed');
    expect(totals.byProvider.map((entry) => [entry.provider, entry.costSource])).toEqual([
      ['claude', 'reported'],
      ['codex', 'estimated'],
    ]);
    const summary = await usageSummary(t.db, t.workspaceId);
    expect(summary.allTime.map((row) => [row.provider, row.costSource])).toEqual([
      ['claude', 'reported'],
      ['codex', 'estimated'],
    ]);
  });

  it('reports nothing for a workspace without runs', async () => {
    expect(await usageSummary(t.db, t.workspaceId)).toEqual({ last30Days: [], allTime: [] });
  });
});
