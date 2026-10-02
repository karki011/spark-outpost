import type {
  DigestState,
  TeammateList,
  TeammateState,
  TeammateView,
  TodaySummary,
} from '@spark-outpost/contracts';

export const SECRET_TITLE = 'Rotate the payments API key in billing/secrets.ts';
export const SECRET_PROJECT = 'acme-payments';

export function today(overrides: Partial<TodaySummary> = {}): TodaySummary {
  return {
    since: '2026-10-02T00:00:00.000Z',
    chats: 3,
    waiting: 1,
    kept: 4,
    prs: 2,
    tickets: 1,
    costUsd: 1.25,
    costSource: null,
    recent: [
      {
        id: '0b9f2a3e-5c1d-4e7a-9f00-000000000001',
        title: SECRET_TITLE,
        project: SECRET_PROJECT,
        state: 'waiting',
        kept: 1,
        prs: 1,
        tickets: 0,
        updatedAt: '2026-10-02T09:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function digest(finishedAt: string | null): DigestState {
  return {
    available: true,
    newActivity: false,
    refreshableAt: null,
    digest: finishedAt
      ? {
          id: '0b9f2a3e-5c1d-4e7a-9f00-000000000002',
          status: 'ready',
          createdAt: finishedAt,
          finishedAt,
          since: '2026-10-01T00:00:00.000Z',
          body: null,
          error: null,
          provider: 'claude',
          modelLabel: null,
          costUsd: null,
          costSource: null,
          conversationId: null,
          stats: { finished: 1, waiting: 1, failedOrStalled: 0, costUsd: null },
        }
      : null,
  };
}

let nextId = 10;

function teammate(name: string, state: TeammateState): TeammateView {
  nextId += 1;
  const id = `0b9f2a3e-5c1d-4e7a-9f00-0000000000${nextId}`;
  return {
    id,
    name,
    role: 'Reviewer',
    face: { shape: 'cloud', color: 'teal' },
    provider: null,
    model: null,
    agentMode: null,
    level: null,
    instructions: `Never mention ${SECRET_PROJECT}`,
    projectIds: [],
    homeConversationId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    state,
    chatCount: 2,
    lastActivity: {
      conversationId: '0b9f2a3e-5c1d-4e7a-9f00-000000000003',
      title: SECRET_TITLE,
      at: '2026-10-02T09:00:00.000Z',
    },
  };
}

export function teammates(spec: [string, TeammateState][]): TeammateList {
  return { teammates: spec.map(([name, state]) => teammate(name, state)), starters: [] };
}
