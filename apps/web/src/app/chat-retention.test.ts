import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../api/client.ts';
import {
  configureChatRetention,
  dropColdChats,
  rememberChat,
  WARM_CHATS,
} from './chat-retention.ts';

function detail(run: string, task: string, page: string) {
  return { runs: [{ id: run }], tasks: [{ id: task }], artifactPages: [{ id: page }] };
}

function seedChat(client: QueryClient, chat: string) {
  client.setQueryData(
    queryKeys.conversation(chat),
    detail(`${chat}-run`, `${chat}-task`, `${chat}-page`),
  );
  client.setQueryData([...queryKeys.conversation(chat), 'workspace'], {});
  client.setQueryData(['tasks', `${chat}-task`, 'changes', 'files'], {});
  client.setQueryData(['tasks', 'change-summaries', `${chat}-task`], {});
  client.setQueryData(['command-output', `${chat}-run`, 'one', 'ended'], {});
  client.setQueryData(['reasoning', `${chat}-run`, 'one'], {});
  client.setQueryData(['artifact', `${chat}-page`, 1], {});
}

const cached = (client: QueryClient, chat: string) =>
  client
    .getQueryCache()
    .getAll()
    .filter((query) => query.queryKey.some((part) => String(part).startsWith(chat))).length;

describe('chat retention', () => {
  it('keeps the most recently opened chats, newest first, without repeats', () => {
    let recent: string[] = [];
    for (let chat = 0; chat < WARM_CHATS + 2; chat += 1) recent = rememberChat(recent, `c${chat}`);
    recent = rememberChat(recent, 'c3');
    expect(recent[0]).toBe('c3');
    expect(recent).toHaveLength(WARM_CHATS);
    expect(new Set(recent).size).toBe(WARM_CHATS);
    expect(recent).not.toContain('c0');
  });

  it('drops a cold chat with its work and keeps warm chats and other data', () => {
    const client = new QueryClient();
    seedChat(client, 'warm');
    seedChat(client, 'cold');
    client.setQueryData(queryKeys.conversations, []);
    client.setQueryData(['projects'], []);

    dropColdChats(client, new Set(['warm']));

    expect(cached(client, 'cold')).toBe(0);
    expect(cached(client, 'warm')).toBe(7);
    expect(client.getQueryData(queryKeys.conversations)).toEqual([]);
    expect(client.getQueryData(['projects'])).toEqual([]);
  });

  it('keeps anything still on screen, such as a member chat in an outpost', () => {
    const client = new QueryClient();
    seedChat(client, 'member');
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.conversation('member'),
      enabled: false,
    });
    const stop = observer.subscribe(() => undefined);

    dropColdChats(client, new Set());

    expect(client.getQueryData(queryKeys.conversation('member'))).toBeDefined();
    expect(client.getQueryData(['tasks', 'member-task', 'changes', 'files'])).toBeDefined();
    stop();
  });

  it('leaves a chat with an unknown owner to its own expiry', () => {
    const client = new QueryClient();
    client.setQueryData(['tasks', 'orphan-task'], {});
    dropColdChats(client, new Set());
    expect(client.getQueryData(['tasks', 'orphan-task'])).toBeDefined();
  });

  it('keeps warm transcripts longer and step details shorter than the default', () => {
    const client = new QueryClient();
    configureChatRetention(client);
    const gc = (key: readonly unknown[]) => client.defaultQueryOptions({ queryKey: key }).gcTime;
    expect(gc(queryKeys.conversation('chat'))).toBeGreaterThan(5 * 60_000);
    expect(gc(['command-output', 'run', 'id', 'ended'])).toBeLessThan(5 * 60_000);
    expect(gc(['reasoning', 'run', 'id'])).toBeLessThan(5 * 60_000);
  });
});
