import type { PrWatch } from '@spark-outpost/contracts';

export const RUN = '0190d7a0-0000-7000-8000-000000000001';

export function watch(fields: Partial<PrWatch> = {}): PrWatch {
  return {
    id: '0190d7a0-0000-7000-8000-0000000000aa',
    conversationId: '0190d7a0-0000-7000-8000-0000000000bb',
    repo: 'acme/widgets',
    number: 7,
    url: 'https://github.com/acme/widgets/pull/7',
    title: 'Tidy the notes',
    branch: 'spark/tidy',
    base: 'main',
    outside: false,
    followUp: true,
    opened: { via: 'agent', by: 'claude', runId: RUN, at: '2026-10-05T10:00:00.000Z' },
    phase: 'watching',
    doing: '',
    prState: 'open',
    draft: false,
    additions: null,
    deletions: null,
    checks: 'passing',
    failingChecks: [],
    review: 'none',
    unknownReason: null,
    rounds: 0,
    quiet: false,
    newComments: 0,
    approvalId: null,
    roundRunId: null,
    lastPolledAt: null,
    nextPollAt: null,
    pollProblem: null,
    lastError: null,
    items: [],
    details: { checkRuns: [], reviewers: [], threads: [], threadCount: 0 },
    ticketSync: [],
    clean: false,
    ...fields,
  };
}
