import { expect, it } from 'vitest';
import type { ConversationDetail, Message, Run } from '@spark-outpost/contracts';
import { retryableMessage } from './retry-turn.ts';

const ASKED = '00000000-0000-4000-8000-000000000010';

function failedRun(extra: Partial<Run> = {}): Run {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userMessageId: ASKED,
    parentRunId: null,
    status: 'failed',
    typedByUser: true,
    ...extra,
  } as Run;
}

function chat(run: Run, extra: Partial<ConversationDetail> = {}, message: Partial<Message> = {}) {
  const asked = { id: ASKED, role: 'user', content: 'Fix it', attachments: [], ...message };
  return {
    messages: [asked as Message],
    runs: [run],
    queue: [],
    ...extra,
  } as unknown as ConversationDetail;
}

it('offers the typed message of the latest failed turn', () => {
  const run = failedRun();
  expect(retryableMessage(chat(run), run)).toBe('Fix it');
});

it('hides it unless the turn failed', () => {
  for (const status of ['succeeded', 'cancelled', 'outcome_unknown', 'running'] as const) {
    const run = failedRun({ status });
    expect(retryableMessage(chat(run), run)).toBeNull();
  }
});

it('hides it on an earlier turn or while another turn runs or a message is queued', () => {
  const earlier = failedRun();
  const later = failedRun({ id: '00000000-0000-4000-8000-000000000002', status: 'succeeded' });
  expect(retryableMessage(chat(earlier, { runs: [earlier, later] }), earlier)).toBeNull();
  const running = failedRun({ id: '00000000-0000-4000-8000-000000000003', status: 'running' });
  expect(retryableMessage(chat(earlier, { runs: [earlier, running] }), earlier)).toBeNull();
  const queue = [{ id: ASKED }] as ConversationDetail['queue'];
  expect(retryableMessage(chat(earlier, { queue }), earlier)).toBeNull();
});

it('hides it for turns the user did not type', () => {
  const outpost = { postId: ASKED } as Run['outpost'];
  const others: Partial<Run>[] = [
    { outpost },
    { prFollowUp: true },
    { agentCycle: true },
    { continuesRunId: ASKED },
    { interruptionChoice: 'continue' },
    { userMessageId: null },
    { typedByUser: false },
    { typedByUser: undefined },
  ];
  for (const extra of others) {
    const run = failedRun(extra);
    expect(retryableMessage(chat(run), run)).toBeNull();
  }
});

it('hides it when the message had attachments or no text', () => {
  const run = failedRun();
  const attachments = [{ id: 'file' }] as Message['attachments'];
  expect(retryableMessage(chat(run, {}, { attachments }), run)).toBeNull();
  expect(retryableMessage(chat(run, {}, { content: '  ' }), run)).toBeNull();
  expect(retryableMessage(chat(run, {}, { role: 'assistant' }), run)).toBeNull();
});
