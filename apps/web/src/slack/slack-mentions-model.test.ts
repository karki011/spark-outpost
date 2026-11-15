import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@spark-outpost/contracts';
import { slackMentionRows } from './slack-mentions-model.ts';

const KEY = 'slack-mention:0190a0e1-0000-7000-8000-000000000001';

function item(over: Partial<AttentionItem>): AttentionItem {
  return {
    key: KEY,
    kind: 'slack-mention',
    blocking: false,
    conversationId: null,
    detail: 'Sam mentioned you in #eng',
    at: '2026-11-15T10:00:00.000Z',
    readAt: null,
    setAsideAt: null,
    dismissedAt: null,
    url: 'https://acme.slack.com/archives/C0ENG/p1',
    ...over,
  };
}

describe('slackMentionRows', () => {
  it('lists unread mentions newest first and leaves out read, dismissed and other items', () => {
    const rows = slackMentionRows([
      item({}),
      item({ key: `${KEY}2`, at: '2026-11-15T11:00:00.000Z', detail: 'Kim mentioned you in #ops' }),
      item({ key: `${KEY}3`, readAt: '2026-11-15T12:00:00.000Z' }),
      item({ key: `${KEY}4`, dismissedAt: '2026-11-15T12:00:00.000Z' }),
      item({ key: 'run-done:x', kind: 'run-done', conversationId: crypto.randomUUID() }),
    ]);
    expect(rows.map((row) => row.line)).toEqual([
      'Kim mentioned you in #ops',
      'Sam mentioned you in #eng',
    ]);
    expect(rows[1]!.url).toBe('https://acme.slack.com/archives/C0ENG/p1');
  });
});
