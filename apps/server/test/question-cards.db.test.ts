import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modeForLegacy, type Approval, type ConversationSummary } from '@spark-outpost/contracts';
import { agentForm } from '../src/agents/acp/elicitation-form.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import {
  approvalAnswerContent,
  getApproval,
  insertApproval,
} from '../src/persistence/approvals.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import type { Provider, QuestionReply } from '../src/providers/provider.ts';
import { questionCard } from '../src/workflow/question-gate.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { codexQuestion } from './fake-acp-questions.ts';
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

const form = agentForm(codexQuestion('thread-1'));
const question = { toolCallId: 'item-ask', rpcId: '5', agent: 'Codex', form };

function asking(withdraw: AbortSignal = new AbortController().signal) {
  const replies: QuestionReply[] = [];
  const provider: Provider = {
    name: 'fake',
    async *run(turn) {
      if (!turn.questions) throw new Error('The turn has no question gate.');
      const reply = await turn.questions.ask(question, turn.signal, withdraw);
      replies.push(reply);
      yield { kind: 'text_delta', delta: `asked=${reply.action}` };
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
    { id: randomUUID(), content: 'Set up the cache' },
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

const api = () => createTestApp(t);
const decide = (id: string, body: object) =>
  request(api())
    .post(`/api/approvals/${id}/decision`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({ scope: 'once', ...body });

const answer = { optionId: 'answer', note: 'What should the cache be called? → hot-cache' };

describe('an agent’s question card', () => {
  it('waits as a question that needs you and sends the first answer back', async () => {
    const replies = asking();
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    expect(card).toMatchObject({
      kind: 'clarify',
      runId,
      toolCallId: 'item-ask',
      title: 'What should the cache be called?',
      options: [
        { optionId: 'answer', kind: 'allow_once' },
        { optionId: 'finish', name: 'Skip', kind: 'reject_once' },
      ],
      payload: {
        form,
        checkpoint: {
          kind: 'clarify',
          agent: 'Codex',
          question: 'Codex needs your input to continue.',
          questions: [{ question: 'What should the cache be called?', options: [] }],
        },
      },
    });
    await eventually(async () => (await getRun(t.db, runId))?.status === 'awaiting_approval');
    const list = await request(api()).get('/api/conversations').set(LOCAL_HEADERS);
    expect(list.body.find((chat: ConversationSummary) => chat.id === conversationId)).toMatchObject(
      {
        needsInput: true,
        attention: { kind: 'input', agentName: 'Codex', approvalId: card.id },
      },
    );

    await decide(card.id, { optionId: 'answer', note: 'hot-cache' }).expect(400);
    const empty = await decide(card.id, { ...answer, answers: [{ picks: [], text: ' ' }] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('Answer “What should the cache be called?”.');
    await decide(card.id, { ...answer, answers: [{ picks: [], text: 'hot-cache' }] }).expect(200);
    await decide(card.id, { ...answer, answers: [{ picks: [], text: 'cold-cache' }] }).expect(409);

    expect((await settled(runId)).status).toBe('succeeded');
    expect(replies).toEqual([{ action: 'accept', content: { name: 'hot-cache' } }]);
    expect(await getApproval(t.db, card.id)).toMatchObject({
      status: 'allowed',
      decidedBy: 'user',
      note: answer.note,
    });
  });

  it('sends the agent’s defaults when the user picks nothing, with no note', async () => {
    const { runId } = await chatTurn();
    const defaults = agentForm({
      sessionId: 's',
      mode: 'form',
      message: 'A few details',
      requestedSchema: {
        type: 'object',
        properties: { notify: { type: 'boolean', title: 'Notify the team?', default: true } },
      },
    });
    const card = await insertApproval(t.db, questionCard(runId, { ...question, form: defaults }));
    await decide(card.id, { optionId: 'answer', answers: [{ picks: [], text: '' }] }).expect(200);
    expect(await approvalAnswerContent(t.db, card.id)).toEqual({ notify: true });
  });

  it('declines when the user skips', async () => {
    const replies = asking();
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    await decide(card.id, { optionId: 'finish' }).expect(200);
    expect((await settled(runId)).status).toBe('succeeded');
    expect(replies).toEqual([{ action: 'decline' }]);
  });

  it('refuses answers on a card that is not an agent question', async () => {
    asking();
    const { conversationId } = await chatTurn();
    const card = await waitingCard(conversationId);
    const other = await insertApproval(t.db, {
      runId: card.runId,
      toolCallId: 'c1',
      rpcId: null,
      kind: 'execute',
      title: 'ls',
      payload: { command: 'ls', cwd: null, paths: [], diffs: [], truncated: false },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      reason: null,
    });
    const refused = await decide(other.id, { optionId: 'allow', answers: [] });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('Only an agent question takes answers.');
    await decide(card.id, { optionId: 'finish' }).expect(200);
    await settled(card.runId);
  });

  it('cancels the question when the turn is stopped', async () => {
    const replies = asking();
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    await requestCancel(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    expect(replies).toEqual([{ action: 'cancel' }]);
    expect(await getApproval(t.db, card.id)).toMatchObject({
      status: 'cancelled',
      decidedBy: 'stop',
    });
    await decide(card.id, { ...answer, answers: [{ picks: [], text: 'late' }] }).expect(409);
  });

  it('closes the card when the agent withdraws its question, and the turn goes on', async () => {
    const withdraw = new AbortController();
    const replies = asking(withdraw.signal);
    const { conversationId, runId } = await chatTurn();
    const card = await waitingCard(conversationId);
    withdraw.abort();
    expect((await settled(runId)).status).toBe('succeeded');
    expect(replies).toEqual([{ action: 'cancel' }]);
    expect(await getApproval(t.db, card.id)).toMatchObject({
      status: 'cancelled',
      decidedBy: 'policy',
    });
  });

  it('leaves no answerable question after Spark restarts', async () => {
    const { runId } = await chatTurn();
    const lease = (await claimNextJob(t.db, 30))!;
    expect(lease.runId).toBe(runId);
    const card = await insertApproval(t.db, questionCard(runId, question));
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    expect(await recoverExpiredLeases(t.db)).toBe(1);
    expect(await getApproval(t.db, card.id)).toMatchObject({
      status: 'expired',
      decidedBy: 'recovery',
    });
    await decide(card.id, { ...answer, answers: [{ picks: [], text: 'late' }] }).expect(409);
  });
});
