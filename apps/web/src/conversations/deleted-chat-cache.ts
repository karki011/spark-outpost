import type { QueryClient } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { leavingDeletedParents } from './sub-chat-tree.ts';
import { patchOlderChats } from './use-older-chats.ts';

export function dropDeletedChat(client: QueryClient, id: string): void {
  const deleted = new Set([id]);
  const apply = (list: ConversationSummary[] | undefined) =>
    list && leavingDeletedParents(list, deleted);
  client.setQueryData<ConversationSummary[]>(queryKeys.conversations, apply);
  patchOlderChats(client, apply);
  client.setQueriesData<ConversationSummary[]>({ queryKey: queryKeys.conversationSearches }, apply);
  client.removeQueries({ queryKey: queryKeys.conversation(id), exact: true });
}
