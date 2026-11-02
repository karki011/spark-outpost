import { describe, expect, it } from 'vitest';
import { parseAttentionKey, type AttentionItem } from './attention-items.ts';
import { attentionReport } from './attention-report.ts';
import type { ConversationSummary } from './conversations.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const CARD = '22222222-2222-4333-8444-555555555555';

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

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: `approval:${CARD}`,
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
  it('carries the chat title beside the notification text', () => {
    const report = attentionReport([chat({ needsInput: true })], [item()]);
    expect(report.requests[0]).toMatchObject({
      key: `approval:${CARD}`,
      chat: 'Fix login',
      title: 'Spark needs you: Fix login',
      body: 'Needs your input',
    });
  });

  it('counts a Terminal session that waits and says what it waits for', () => {
    const terminal = { state: 'waiting_for_permission' } as ConversationSummary['terminal'];
    const report = attentionReport(
      [chat({ sessionType: 'terminal', terminal })],
      [item({ key: `terminal:${CARD}:1:5`, kind: 'terminal' })],
    );
    expect(report.count).toBe(1);
    expect(report.requests[0]!.body).toBe('Waiting for permission');
  });

  it('leaves out what was read, set aside or dismissed, and every update', () => {
    const report = attentionReport(
      [chat({ needsInput: true })],
      [
        item({ readAt: '2026-10-12T10:01:00.000Z' }),
        item({ setAsideAt: '2026-10-12T10:01:00.000Z' }),
        item({ dismissedAt: '2026-10-12T10:01:00.000Z' }),
        item({ key: `flag:${CARD}`, kind: 'flag', blocking: false }),
        item({ key: `run-failed:${CARD}`, kind: 'run-failed', blocking: false }),
      ],
    );
    expect(report).toEqual({ count: 0, requests: [] });
  });

  it('skips an item whose chat is archived or not listed', () => {
    const archived = chat({ archivedAt: '2026-10-12T10:00:00.000Z' });
    expect(attentionReport([archived], [item()]).count).toBe(0);
    expect(attentionReport([], [item()]).count).toBe(0);
  });
});

describe('parseAttentionKey', () => {
  it('reads each kind of key and refuses anything else', () => {
    expect(parseAttentionKey(`approval:${CARD}`)).toEqual({ kind: 'approval', id: CARD });
    expect(parseAttentionKey(`run-done:${CARD}`)).toEqual({ kind: 'run-done', id: CARD });
    expect(parseAttentionKey(`terminal:${CARD}:3:1700000000000`)).toEqual({
      kind: 'terminal',
      id: CARD,
      generation: 3,
      since: 1_700_000_000_000,
    });
    expect(parseAttentionKey(`chat:${CHAT}:x`)).toBeNull();
    expect(parseAttentionKey(`approval:${CARD}x`)).toBeNull();
    expect(parseAttentionKey('approval:../../etc')).toBeNull();
  });
});
