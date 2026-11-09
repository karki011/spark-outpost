import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modeForLegacy, type Approval, type ConversationSummary } from '@spark-outpost/contracts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getApproval } from '../src/persistence/approvals.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import type { AddressAsk, AddressReply, Provider } from '../src/providers/provider.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { OAUTH_URL } from './fake-acp-questions.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

const ask: AddressAsk = {
  toolCallId: 'elicitation:mcp-oauth-1',
  rpcId: '7',
  agent: 'Codex',
  url: OAUTH_URL,
  message: 'Authenticate with MCP server docs',
  secretFiles: [],
};

function opening(withdraw: AbortSignal = new AbortController().signal, asked = ask) {
  const replies: AddressReply[] = [];
  const provider: Provider = {
    name: 'fake',
    async *run(turn) {
      if (!turn.questions) throw new Error('The turn has no question gate.');
      const reply = await turn.questions.open(asked, turn.signal, withdraw);
      replies.push(reply);
      yield { kind: 'text_delta', delta: `opened=${reply}` };
    },
  };
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
  });
  return replies;
}

async function chatTurn() {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Use the docs server' },
    {
      provider: 'fake',
      permission: 'ask',
      agentMode: modeForLegacy('codex', 'ask', null),
      level: 'hands-off',
    },
  );
  return { conversationId: conversation.id, runId: sent.run.id };
}

async function waitingCard(conversationId: string): Promise<Approval> {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    return detail?.approvals.find((approval) => approval.status === 'pending') ?? null;
  });
}

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  });
}

const decide = (id: string, optionId: string) =>
  request(createTestApp(t))
    .post(`/api/approvals/${id}/decision`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({ scope: 'once', optionId });

describe('an Open this address card', () => {
  it('waits as a card that needs you and answers accept once the user opens it', async () => {
    const replies = opening();
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    expect(card).toMatchObject({
      kind: 'other',
      title: 'Open this address?',
      toolCallId: ask.toolCallId,
      payload: {
        openAddress: { url: OAUTH_URL, host: 'auth.example.com', message: ask.message },
      },
    });
    await eventually(async () => (await getRun(t.db, runId))?.status === 'awaiting_approval');
    const list = await request(createTestApp(t)).get('/api/conversations').set(LOCAL_HEADERS);
    expect(list.body.find((chat: ConversationSummary) => chat.id === conversationId)).toMatchObject(
      { needsInput: true, attention: { approvalId: card.id } },
    );
    await decide(card.id, 'open').expect(200);
    expect((await settled(runId)).status).toBe('succeeded');
    expect(replies).toEqual(['accept']);
  });

  it('answers decline on Don’t', async () => {
    const replies = opening();
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    await decide(card.id, 'dont').expect(200);
    expect((await settled(runId)).status).toBe('succeeded');
    expect(replies).toEqual(['decline']);
  });

  it('holds to confirm when the address holds a secret value', async () => {
    opening(undefined, { ...ask, secretFiles: ['.env'] });
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    expect(card.payload.secretSend).toEqual(['.env']);
    await decide(card.id, 'dont').expect(200);
    await settled(runId);
  });

  it('answers cancel when the turn is stopped', async () => {
    const replies = opening();
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    await requestCancel(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    expect(replies).toEqual(['cancel']);
    expect(await getApproval(t.db, card.id)).toMatchObject({ status: 'cancelled' });
    await decide(card.id, 'open').expect(409);
  });

  it('closes the card when the agent completes or withdraws it, and the turn goes on', async () => {
    const withdraw = new AbortController();
    const replies = opening(withdraw.signal);
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    withdraw.abort();
    expect((await settled(runId)).status).toBe('succeeded');
    expect(replies).toEqual(['cancel']);
    expect(await getApproval(t.db, card.id)).toMatchObject({
      status: 'cancelled',
      decidedBy: 'policy',
    });
  });
});
