import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { EventType, type RunEvent } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { refreshAfter } from './use-run-stream.ts';

const CHAT = 'chat-1';
const detailKey = queryKeys.conversation(CHAT);
const pushesKey = [...detailKey, 'pushes'];
const ticketsKey = [...detailKey, 'tickets'];

function seeded(): QueryClient {
  const client = new QueryClient();
  for (const key of [detailKey, pushesKey, ticketsKey]) client.setQueryData(key, {});
  return client;
}

const stale = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated;

describe('refreshAfter', () => {
  it('refreshes the chat and everything kept under it when a run ends', () => {
    const client = seeded();
    refreshAfter(client, CHAT, { type: EventType.RUN_FINISHED } as RunEvent);
    expect(stale(client, detailKey)).toBe(true);
    expect(stale(client, pushesKey)).toBe(true);
    expect(stale(client, ticketsKey)).toBe(true);
  });

  it('refreshes nothing for streamed text', () => {
    const client = seeded();
    const text = { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'hi' } as RunEvent;
    refreshAfter(client, CHAT, text);
    expect(stale(client, detailKey)).toBe(false);
    expect(stale(client, pushesKey)).toBe(false);
  });
});
