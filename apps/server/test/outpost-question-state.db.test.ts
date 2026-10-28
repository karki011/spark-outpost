import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { requestState } from '@spark-outpost/contracts';
import { agentForm } from '../src/agents/acp/elicitation-form.ts';
import { decideApproval, insertApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { getPost } from '../src/persistence/outpost-posts.ts';
import type { Provider } from '../src/providers/provider.ts';
import { getRun } from '../src/persistence/runs.ts';
import { questionCard } from '../src/workflow/question-gate.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { codexQuestion } from './fake-acp-questions.ts';
import { addMemberChat, createOutpostRow, deliverRequest } from './outpost-fixtures.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;
let resume = () => {};

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  resume();
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

it('resumes the Outpost request only after all concurrent questions are answered', async () => {
  const outpostId = await createOutpostRow(t);
  const chatId = await addMemberChat(t, outpostId, 'builder');
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: chatId,
    toHandle: 'builder',
  });
  await drainQueue(t.db, chatId, async () => ({ provider: 'fake' }));
  const held = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const provider: Provider = {
    name: 'fake',
    async *run(turn) {
      if (!turn.questions) throw new Error('Missing question gate');
      await Promise.all(
        [1, 2].map((index) =>
          turn.questions!.ask(
            {
              toolCallId: `question-${index}`,
              rpcId: randomUUID(),
              agent: 'Builder',
              form: agentForm(codexQuestion('thread-1')),
            },
            turn.signal,
            new AbortController().signal,
          ),
        ),
      );
      yield { kind: 'text_delta', delta: 'Working on your answers.' };
      await held;
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
  const questions = await eventually(async () => {
    const detail = await getConversationDetail(t.db, chatId);
    const pending = detail?.approvals.filter((approval) => approval.status === 'pending') ?? [];
    return pending.length === 2 ? pending : null;
  });
  const state = async () => requestState((await getPost(t.db, postId))!.facts!).state;
  await eventually(async () => (await state()) === 'needs_you');
  const answer = (id: string) =>
    decideApproval(t.db, t.workspaceId, id, {
      optionId: 'answer',
      scope: 'once',
      answers: [{ picks: [], text: 'hot-cache' }],
    });
  await answer(questions[0]!.id);
  expect(await state()).toBe('needs_you');
  await answer(questions[1]!.id);
  await eventually(async () => (await state()) === 'working');
});

it('clears the answered question before worker acknowledgement without changing the run', async () => {
  const outpostId = await createOutpostRow(t);
  const chatId = await addMemberChat(t, outpostId, 'builder');
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: chatId,
    toHandle: 'builder',
  });
  await drainQueue(t.db, chatId, async () => ({ provider: 'fake' }));
  const runId = (await getPost(t.db, postId))!.post.runId!;
  const card = await insertApproval(
    t.db,
    questionCard(runId, {
      toolCallId: 'question',
      rpcId: '1',
      agent: 'Builder',
      form: agentForm(codexQuestion('thread-1')),
    }),
  );
  await t.db.query("UPDATE runs SET status = 'awaiting_approval' WHERE id = $1", [runId]);
  const state = async () => requestState((await getPost(t.db, postId))!.facts!).state;
  expect(await state()).toBe('needs_you');
  await decideApproval(t.db, t.workspaceId, card.id, {
    optionId: 'answer',
    scope: 'once',
    answers: [{ picks: [], text: 'hot-cache' }],
  });
  expect(await state()).toBe('working');
  const childId = randomUUID();
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
       role, prompt)
     VALUES ($1, $2, $3, 'fake', 'running', $4, 'builder', 'Build the endpoint.')`,
    [childId, chatId, postId, runId],
  );
  const childCard = await insertApproval(
    t.db,
    questionCard(childId, {
      toolCallId: 'child-question',
      rpcId: '2',
      agent: 'Builder',
      form: agentForm(codexQuestion('thread-2')),
    }),
  );
  expect(await state()).toBe('needs_you');
  await decideApproval(t.db, t.workspaceId, childCard.id, {
    optionId: 'answer',
    scope: 'once',
    answers: [{ picks: [], text: 'cold-cache' }],
  });
  expect(await state()).toBe('working');
  expect((await getRun(t.db, runId))?.status).toBe('awaiting_approval');
  for (const status of ['failed', 'cancelled', 'succeeded'] as const) {
    await t.db.query('UPDATE runs SET status = $2 WHERE id = $1', [runId, status]);
    expect(await state()).toBe(status === 'succeeded' ? 'answered' : status);
  }
});
