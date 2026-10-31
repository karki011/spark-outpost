import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { queryKeys } from '../../api/client.ts';
import { patchRunStep } from './step-patch.ts';

const CHAT = '0198c0de-0000-7000-8000-000000000001';
const OTHER = '0198c0de-0000-7000-8000-000000000002';
const RUN = '0198c0de-0000-7000-8000-00000000000a';

const summary = (id: string, status = 'running', runId = RUN) =>
  ({ id, latestRun: { id: runId, status, step: 'Reading' } }) as unknown as ConversationSummary;

function clientWith(list: ConversationSummary[]) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.conversations, list);
  return client;
}

const started = (step: string, runId = RUN) =>
  ({ kind: 'step', conversationId: CHAT, runId, phase: 'started', step }) as const;

const stepsIn = (client: QueryClient) =>
  client
    .getQueryData<ConversationSummary[]>(queryKeys.conversations)!
    .map((chat) => chat.latestRun?.step);

describe('patchRunStep', () => {
  it('names the new step on the chat row and in the open chat, with no other row changed', () => {
    const other = summary(OTHER);
    const client = clientWith([summary(CHAT), other]);
    client.setQueryData(queryKeys.conversation(CHAT), { conversation: summary(CHAT) });

    patchRunStep(client, started('Writing a reply'));

    expect(stepsIn(client)).toEqual(['Writing a reply', 'Reading']);
    expect(client.getQueryData<ConversationSummary[]>(queryKeys.conversations)![1]).toBe(other);
    expect(
      client.getQueryData<{ conversation: ConversationSummary }>(queryKeys.conversation(CHAT))!
        .conversation.latestRun?.step,
    ).toBe('Writing a reply');
  });

  it('leaves a row alone when the step belongs to another run or the run is no longer running', () => {
    const client = clientWith([summary(CHAT)]);
    patchRunStep(client, started('Late', OTHER));
    expect(stepsIn(client)).toEqual(['Reading']);

    const stopped = clientWith([summary(CHAT, 'succeeded')]);
    patchRunStep(stopped, started('Late'));
    expect(stepsIn(stopped)).toEqual(['Reading']);
  });

  it('keeps the same list when nothing changes and ignores a finished step', () => {
    const client = clientWith([summary(CHAT)]);
    const before = client.getQueryData(queryKeys.conversations);
    patchRunStep(client, started('Reading'));
    patchRunStep(client, { kind: 'step', conversationId: CHAT, runId: RUN, phase: 'finished' });
    expect(client.getQueryData(queryKeys.conversations)).toBe(before);
  });
});
