import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { stepsLeaveDetail } from './use-island-data.ts';

const SOLO = '11111111-1111-4111-8111-111111111111';
const CREW = '22222222-2222-4222-8222-222222222222';
const UNSEEN = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

function detail(crewSize: number): ConversationDetail {
  const crew = Array.from({ length: crewSize }, (_, index) => ({
    runId: index === 0 ? RUN : `child-${index}`,
    role: 'builder',
  }));
  return {
    runs: [{ id: RUN }],
    orchestrations: crewSize ? { [RUN]: { runId: RUN, depth: 'direct', crew } } : {},
    activity: {},
  } as unknown as ConversationDetail;
}

describe('stepsLeaveDetail', () => {
  it('lets steps skip the refetch for a chat with one agent or none cached, and keeps it for a crew turn whose lines come from steps', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.conversation(SOLO), detail(0));
    client.setQueryData(queryKeys.conversation(CREW), detail(2));
    const covered = stepsLeaveDetail(client);
    expect(covered(SOLO)).toBe(true);
    expect(covered(UNSEEN)).toBe(true);
    expect(covered(CREW)).toBe(false);
  });
});
