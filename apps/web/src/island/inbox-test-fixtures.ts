import type { Approval, ConversationSummary, SubagentRow } from '@spark-outpost/contracts';
import type { Card } from './island-model.ts';

export const CHAT_A = '0c000000-0000-4000-8000-00000000000a';
export const CHAT_B = '0c000000-0000-4000-8000-00000000000b';
export const RUN_A = '0e000000-0000-4000-8000-00000000000a';

export function chat(
  id: string,
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id,
    title: `Chat ${id.slice(-1)}`,
    updatedAt: '2026-10-20T10:00:00.000Z',
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

export function run(
  status: string,
  extra: Partial<NonNullable<ConversationSummary['latestRun']>> = {},
): ConversationSummary['latestRun'] {
  return {
    id: RUN_A,
    status,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
    finishedAt: null,
    ...extra,
  } as ConversationSummary['latestRun'];
}

export function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    runId: RUN_A,
    toolCallId: 'call_1',
    kind: 'execute',
    title: 'gh workflow run cd-alfa.yml',
    payload: {
      command: 'gh workflow run cd-alfa.yml',
      cwd: '/work',
      paths: [],
      diffs: [],
      truncated: false,
    },
    payloadHash: 'sha256:abc',
    options: [
      { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
    ],
    status: 'pending',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-20T09:58:00.000Z',
    ...overrides,
  };
}

export function card(kind: Card['kind'], overrides: Partial<Card> = {}): Card {
  return {
    kind,
    chat: chat(CHAT_A, { needsInput: true, title: 'orders-web-app' }),
    approval: kind === 'open' ? null : approval(),
    loading: false,
    ...overrides,
  };
}

export function subagent(id: string, state: SubagentRow['state']): SubagentRow {
  return { id, state } as SubagentRow;
}
