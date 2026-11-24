import { expect, it } from 'vitest';
import type { ConversationDetail, Message, Run } from '@spark-outpost/contracts';
import { buildTurns } from '../turns.ts';
import { withSavedSend } from './saved-send.ts';

const earlier = { id: 'message-1', role: 'user' } as Message;
const earlierRun = { id: 'run-1', userMessageId: 'message-1' } as Run;
const message = { id: 'message-2', role: 'user' } as Message;
const run = { id: 'run-2', userMessageId: 'message-2', status: 'queued' } as Run;
const detail = { messages: [earlier], runs: [earlierRun] } as ConversationDetail;

it('shows the accepted message as a turn before the chat is fetched again', () => {
  const turns = buildTurns(withSavedSend(detail, { message, run }));
  expect(turns.at(-1)).toMatchObject({ run, userMessage: message, assistantMessage: null });
});

it('leaves a chat that already holds the message and its turn untouched', () => {
  const fetched = { ...detail, messages: [earlier, message], runs: [earlierRun, run] };
  expect(withSavedSend(fetched, { message, run })).toBe(fetched);
});

it('adds only the part a fetch has not delivered yet', () => {
  const partial = { ...detail, runs: [earlierRun, run] };
  const next = withSavedSend(partial, { message, run });
  expect(next.messages).toEqual([earlier, message]);
  expect(next.runs).toEqual([earlierRun, run]);
});

it('ignores a response without a message and a turn', () => {
  expect(withSavedSend(detail, {})).toBe(detail);
});
