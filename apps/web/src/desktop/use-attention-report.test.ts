import { describe, expect, it } from 'vitest';
import {
  attentionReport,
  type AttentionItem,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { rowState } from '../conversations/row-state.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const OTHER = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const APPROVAL = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const RUN = '99999999-8888-4777-8666-555555555555';

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: CHAT,
    title: 'Fix login',
    updatedAt: '2026-10-12T10:00:00.000Z',
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

const asking = chat({
  needsInput: true,
  attention: {
    kind: 'permission',
    title: 'run a command',
    agentName: null,
    provider: 'claude',
    approvalId: APPROVAL,
  },
});

function cardItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: `approval:${APPROVAL}`,
    kind: 'approval',
    blocking: true,
    conversationId: CHAT,
    detail: null,
    at: '2026-10-12T10:00:00.000Z',
    readAt: null,
    setAsideAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

describe('attentionReport', () => {
  it('reports nothing when no chat needs the user', () => {
    expect(attentionReport([chat()], [])).toEqual({ count: 0, requests: [] });
  });

  it('names the chat and uses the sidebar attention line, keyed by the item', () => {
    expect(attentionReport([asking], [cardItem()])).toEqual({
      count: 1,
      requests: [
        {
          key: `approval:${APPROVAL}`,
          chatId: CHAT,
          chat: 'Fix login',
          title: 'Spark needs you: Fix login',
          body: rowState(asking, false).sub,
        },
      ],
    });
    expect(rowState(asking, false).sub).toContain('wants to run a command');
  });

  it('names an outpost member by its handle and outpost', () => {
    const member = { ...asking, outpost: { id: OTHER, name: 'Launch', handle: 'api' } };
    expect(attentionReport([member], [cardItem()]).requests[0]!.title).toBe(
      '@api needs you in Launch',
    );
  });

  it('leaves archived chats and items read anywhere out', () => {
    const archived = chat({ id: OTHER, needsInput: true, archivedAt: '2026-10-01' });
    const items = [
      cardItem(),
      cardItem({ key: `approval:${RUN}`, conversationId: OTHER }),
      cardItem({ key: `approval:${OTHER}`, readAt: '2026-10-12T10:01:00.000Z' }),
    ];
    const report = attentionReport([asking, archived], items);
    expect(report.requests.map((request) => request.key)).toEqual([`approval:${APPROVAL}`]);
  });
});
