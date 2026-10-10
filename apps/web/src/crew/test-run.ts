import type { Run } from '@spark-outpost/contracts';

export const RUN_ID = '00000000-0000-4000-8000-000000000001';

export function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    conversationId: '00000000-0000-4000-8000-000000000002',
    userMessageId: '00000000-0000-4000-8000-000000000003',
    provider: 'claude',
    status: 'succeeded',
    error: null,
    cancelRequested: false,
    createdAt: '2026-10-10T10:00:00.000Z',
    startedAt: '2026-10-10T10:00:01.000Z',
    finishedAt: '2026-10-10T10:00:39.000Z',
    model: 'sonnet-5',
    effort: 'medium',
    usage: null,
    mode: 'do',
    level: 'full-auto',
    snapshot: null,
    revertedAt: null,
    ...overrides,
  };
}
