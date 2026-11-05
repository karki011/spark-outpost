import { useEffect, useRef } from 'react';
import { useQueryClient, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { taskKeys } from '../tasks/task-api.ts';

export const WARM_CHATS = 5;
const WARM_GC_MS = 15 * 60_000;
const STEP_DETAIL_GC_MS = 2 * 60_000;

const CHATS_ROOT = queryKeys.conversations[0];
const COMMAND_OUTPUT_ROOT = 'command-output';
const REASONING_ROOT = 'reasoning';
const ARTIFACT_ROOT = 'artifact';
const WORK_ROOTS: ReadonlySet<unknown> = new Set([
  taskKeys.all[0],
  COMMAND_OUTPUT_ROOT,
  REASONING_ROOT,
  ARTIFACT_ROOT,
]);

export function configureChatRetention(client: QueryClient): void {
  client.setQueryDefaults([CHATS_ROOT], { gcTime: WARM_GC_MS });
  client.setQueryDefaults([COMMAND_OUTPUT_ROOT], { gcTime: STEP_DETAIL_GC_MS });
  client.setQueryDefaults([REASONING_ROOT], { gcTime: STEP_DETAIL_GC_MS });
}

function chatOf(key: QueryKey): string | null {
  return key[0] === CHATS_ROOT && typeof key[1] === 'string' ? key[1] : null;
}

function workIds(detail: ConversationDetail | undefined): string[] {
  if (!detail) return [];
  return [
    ...detail.runs.map((run) => run.id),
    ...detail.tasks.map((task) => task.id),
    ...(detail.artifactPages ?? []).map((page) => page.id),
  ];
}

function coldWork(queries: readonly Query[], warm: ReadonlySet<string>): Set<unknown> {
  const ids = new Set<unknown>();
  for (const query of queries) {
    const chat = chatOf(query.queryKey);
    if (!chat || warm.has(chat) || query.queryKey.length !== 2) continue;
    if (query.getObserversCount() > 0) continue;
    for (const id of workIds(query.state.data as ConversationDetail | undefined)) ids.add(id);
  }
  return ids;
}

export function rememberChat(recent: readonly string[], chat: string): string[] {
  return [chat, ...recent.filter((id) => id !== chat)].slice(0, WARM_CHATS);
}

export function dropColdChats(client: QueryClient, warm: ReadonlySet<string>): void {
  const cache = client.getQueryCache();
  const queries = cache.getAll();
  const work = coldWork(queries, warm);
  for (const query of queries) {
    if (query.getObserversCount() > 0) continue;
    const key = query.queryKey;
    const chat = chatOf(key);
    const cold = chat
      ? !warm.has(chat)
      : WORK_ROOTS.has(key[0]) && key.slice(1).some((part) => work.has(part));
    if (cold) cache.remove(query);
  }
}

export function useChatRetention(openChat: string | null): void {
  const client = useQueryClient();
  const recent = useRef<string[]>([]);
  useEffect(() => {
    if (!openChat) return;
    recent.current = rememberChat(recent.current, openChat);
    dropColdChats(client, new Set(recent.current));
  }, [client, openChat]);
}
