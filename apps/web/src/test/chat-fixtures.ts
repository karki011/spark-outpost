import type { ConversationSummary } from '@spark-outpost/contracts';

export const FE_CHAT = '0c000000-0000-4000-8000-000000000001';
export const API_CHAT = '0c000000-0000-4000-8000-000000000002';

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
