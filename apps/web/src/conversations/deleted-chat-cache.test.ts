import { describe, expect, it } from 'vitest';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { dropDeletedChat } from './deleted-chat-cache.ts';
import { parentMarkText } from './sub-chat-tree.ts';

type Pages = InfiniteData<ConversationSummary[], string>;

const PARENT = { id: 'parent', title: 'Checkout rewrite' };
const OLDER = [...queryKeys.olderConversations, 'cursor'];
const SEARCH = queryKeys.conversationSearch('checkout');
const WAS_PART = '· was part of Checkout rewrite';

const chat = (id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: id,
  updatedAt: '2026-11-20T10:00:00.000Z',
  projectIds: [],
  latestRun: null,
  archivedAt: null,
  pinnedAt: null,
  pinnedOrder: null,
  projectOrder: null,
  unread: false,
  needsInput: false,
  attention: null,
  titleSource: 'message',
  category: null,
  ...extra,
});

const sub = (id: string, position: number): ConversationSummary =>
  Object.freeze(chat(id, { parent: PARENT, subChat: { position, status: 'working' } }));

function seeded() {
  const client = new QueryClient();
  const parent = chat(PARENT.id, { title: PARENT.title, subChatCount: 3 });
  const other = chat('other');
  const [api, page, spike] = [sub('api', 0), sub('page', 1), sub('spike', 2)];
  client.setQueryData<ConversationSummary[]>(queryKeys.conversations, [parent, api, other]);
  client.setQueryData<Pages>(OLDER, { pages: [[page], [spike, parent]], pageParams: ['a', 'b'] });
  client.setQueryData<ConversationSummary[]>(SEARCH, [parent, api, page]);
  client.setQueryData(queryKeys.conversation(PARENT.id), { conversation: parent });
  return { client, api };
}

const marks = (chats: readonly ConversationSummary[] | undefined) =>
  chats?.map((each) => [each.id, parentMarkText(each), each.parent]);

describe('the chat caches after a delete finishes', () => {
  it('drop the chat and keep its sub-chats saying what they were part of', () => {
    const { client } = seeded();

    dropDeletedChat(client, PARENT.id);

    expect(marks(client.getQueryData<ConversationSummary[]>(queryKeys.conversations))).toEqual([
      ['api', WAS_PART, undefined],
      ['other', null, undefined],
    ]);
    expect(client.getQueryData<Pages>(OLDER)?.pages.map(marks)).toEqual([
      [['page', WAS_PART, undefined]],
      [['spike', WAS_PART, undefined]],
    ]);
    expect(client.getQueryData<Pages>(OLDER)?.pageParams).toEqual(['a', 'b']);
    expect(marks(client.getQueryData<ConversationSummary[]>(SEARCH))).toEqual([
      ['api', WAS_PART, undefined],
      ['page', WAS_PART, undefined],
    ]);
    expect(client.getQueryData(queryKeys.conversation(PARENT.id))).toBeUndefined();
  });

  it('change no cached chat in place', () => {
    const { client, api } = seeded();
    const before = client.getQueryData<ConversationSummary[]>(queryKeys.conversations);

    dropDeletedChat(client, PARENT.id);

    expect(api.parent).toEqual(PARENT);
    expect(api.formerParent).toBeUndefined();
    expect(before?.map((each) => each.id)).toEqual([PARENT.id, 'api', 'other']);
    expect(client.getQueryData(queryKeys.conversations)).not.toBe(before);
  });

  it('leave the sub-chats of other parents under their parent', () => {
    const { client } = seeded();

    dropDeletedChat(client, 'other');

    expect(marks(client.getQueryData<ConversationSummary[]>(queryKeys.conversations))).toEqual([
      [PARENT.id, null, undefined],
      ['api', '↳ Checkout rewrite', PARENT],
    ]);
  });
});
