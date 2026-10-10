import type {
  ConversationSummary,
  Outpost,
  OutpostDetail,
  OutpostMember,
  OutpostPost,
} from '@spark-outpost/contracts';
import type { MemberView } from './member-view.ts';

export const OUTPOST_ID = '0a000000-0000-4000-8000-000000000001';
export const FE_CHAT = '0c000000-0000-4000-8000-000000000001';
export const API_CHAT = '0c000000-0000-4000-8000-000000000002';
export const DOCS_CHAT = '0c000000-0000-4000-8000-000000000003';
export const WEB_PROJECT = '0d000000-0000-4000-8000-000000000001';

export function postId(number: number): string {
  return `0b000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

export function chat(
  id: string,
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id,
    title: 'Usage page',
    updatedAt: '2026-10-09T10:00:00.000Z',
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
    ...overrides,
  };
}

export function member(conversationId: string, handle: string, position: number): OutpostMember {
  return { conversationId, handle, position, joinedAt: '2026-10-09T10:00:00.000Z' };
}

export function outpost(overrides: Partial<Outpost> = {}): Outpost {
  return {
    id: OUTPOST_ID,
    name: 'Usage by user',
    pausedAt: null,
    createdAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-09T10:00:00.000Z',
    members: [member(FE_CHAT, 'fe', 1), member(API_CHAT, 'api', 2)],
    needsYou: 0,
    ...overrides,
  };
}

export function post(number: number, overrides: Partial<OutpostPost> = {}): OutpostPost {
  return {
    id: postId(number),
    outpostId: OUTPOST_ID,
    kind: 'request',
    body: 'Add an optional userId filter.',
    fromUser: true,
    fromSpark: false,
    fromConversationId: null,
    fromRunId: null,
    fromHandle: null,
    userStarted: false,
    held: false,
    toConversationId: API_CHAT,
    toHandle: 'api',
    guest: false,
    waits: false,
    batchId: null,
    taskId: null,
    runId: null,
    pinnedAt: null,
    createdAt: `2026-10-09T10:${String(number).padStart(2, '0')}:00.000Z`,
    state: 'sent',
    reason: null,
    answer: null,
    exchanges: [],
    files: 0,
    intro: null,
    ...overrides,
  };
}

export function note(number: number, overrides: Partial<OutpostPost> = {}): OutpostPost {
  return post(number, {
    kind: 'note',
    body: 'The contract is settled.',
    toConversationId: null,
    toHandle: null,
    state: null,
    ...overrides,
  });
}

export function notice(number: number, body: string): OutpostPost {
  return post(number, {
    kind: 'notice',
    body,
    fromUser: false,
    toConversationId: null,
    toHandle: null,
    state: null,
  });
}

export function detail(posts: OutpostPost[] = [], overrides: Partial<Outpost> = {}): OutpostDetail {
  return { outpost: outpost(overrides), posts, stories: [] };
}

export function memberView(
  conversationId: string,
  handle: string,
  overrides: Partial<MemberView> = {},
): MemberView {
  return {
    conversationId,
    handle,
    title: `Chat ${handle}`,
    place: '',
    agent: null,
    state: 'idle',
    stateLabel: 'Idle',
    archived: false,
    ...overrides,
  };
}
