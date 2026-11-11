import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateChatDetail } from './chat-detail.ts';
import { queryKeys } from './client.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('invalidateChatDetail', () => {
  it('marks only the detail stale and leaves sibling keys and other chats alone', async () => {
    const client = new QueryClient();
    const keys = {
      detail: queryKeys.conversation(A),
      commands: queryKeys.agentCommands(A),
      annotations: queryKeys.annotations(A),
      drafts: [...queryKeys.conversation(A), 'outpost-drafts'],
      other: queryKeys.conversation(B),
    };
    for (const key of Object.values(keys)) client.setQueryData(key, 'cached');

    await invalidateChatDetail(client, A);

    const stale = Object.entries(keys)
      .filter(([, key]) => client.getQueryState(key)?.isInvalidated)
      .map(([name]) => name);
    expect(stale).toEqual(['detail']);
  });
});
