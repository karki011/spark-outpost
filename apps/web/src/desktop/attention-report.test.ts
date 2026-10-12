import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { attention, rowState } from '../conversations/row-state.ts';
import { attentionReport } from './attention-report.ts';

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

describe('attentionReport', () => {
  it('reports nothing when no chat needs the user', () => {
    expect(attentionReport([chat()])).toEqual({ count: 0, requests: [] });
  });

  it('names the chat and uses the sidebar attention line, keyed by the request', () => {
    expect(attentionReport([asking])).toEqual({
      count: 1,
      requests: [
        {
          key: APPROVAL,
          chatId: CHAT,
          title: 'Spark needs you: Fix login',
          body: rowState(asking, false).sub,
        },
      ],
    });
    expect(rowState(asking, false).sub).toContain('wants to run a command');
  });

  it('names an outpost member by its handle and outpost', () => {
    const member = { ...asking, outpost: { id: OTHER, name: 'Launch', handle: 'api' } };
    expect(attentionReport([member]).requests[0]!.title).toBe('@api needs you in Launch');
  });

  it('counts what the sidebar counts and leaves archived chats out', () => {
    const chats = [asking, chat({ id: OTHER, needsInput: true, archivedAt: '2026-10-01' })];
    const report = attentionReport(chats);
    expect(report.count).toBe(attention(chats, null).count);
    expect(report.requests.map((request) => request.chatId)).toEqual([CHAT]);
  });

  it('keys a request without an approval by its chat and turn', () => {
    const run = {
      id: RUN,
      status: 'running' as const,
      error: null,
      step: null,
      provider: null,
      progress: null,
    };
    const waiting = chat({ needsInput: true, latestRun: run });
    expect(attentionReport([waiting]).requests[0]!.key).toBe(`chat:${CHAT}:${RUN}`);
  });
});
