import { describe, expect, it } from 'vitest';
import type { DigestStats } from '@spark-outpost/contracts';
import type { FlaggedItem } from '../persistence/attention-settings.ts';
import { briefItems } from './brief-items.ts';
import { parseDigestReply } from './parse.ts';

const flagged: FlaggedItem[] = [
  {
    itemId: 'ticket:jira:API-77',
    key: 'API-77',
    title: 'Rate limit headers missing',
    source: 'jira',
    status: 'Code Review',
    priority: 'High',
    dueDate: null,
    project: 'API',
    pullRequest: { repo: 'acme/api', number: 88, state: 'review' },
    flags: [{ rule: 'review-slow', text: 'PR #88 in review', days: 4 }],
  },
  {
    itemId: 'ticket:linear:WEB-433',
    key: 'WEB-433',
    title: 'Session expires during long uploads',
    source: 'linear',
    status: 'Todo',
    priority: 'Urgent',
    dueDate: '2026-09-29',
    project: 'WEB',
    pullRequest: null,
    flags: [{ rule: 'high-idle', text: 'Urgent · not started', days: 3 }],
  },
];

describe('briefItems', () => {
  it('treats ServiceNow record numbers as keys too', () => {
    const items = briefItems(
      [
        { itemId: 'ticket:jira:API-77', text: 'Also INC0010099 needs you.' },
        { itemId: 'ticket:linear:WEB-433', text: 'Start WEB-433 first.' },
      ],
      flagged,
    );
    expect(items.map((item) => item.itemId)).toEqual(['ticket:linear:WEB-433']);
  });

  it('keeps items that point at flagged tickets, in the order given', () => {
    const items = briefItems(
      [
        { itemId: 'ticket:linear:WEB-433', text: 'Start WEB-433 first; it has waited 3 days.' },
        { itemId: 'ticket:jira:API-77', text: 'Nudge a reviewer on PR #88, open for 4 days.' },
      ],
      flagged,
    );
    expect(items.map((item) => item.itemId)).toEqual([
      'ticket:linear:WEB-433',
      'ticket:jira:API-77',
    ]);
  });

  it('drops unknown ids, repeats and lines that invent keys, PRs or day counts', () => {
    const items = briefItems(
      [
        { itemId: 'ticket:jira:API-99', text: 'Made up.' },
        { itemId: 'ticket:jira:API-77', text: 'Also look at WEB-999 while you are there.' },
        { itemId: 'ticket:jira:API-77', text: 'PR #91 needs a reviewer.' },
        { itemId: 'ticket:jira:API-77', text: 'It has waited 12 days.' },
        { itemId: 'ticket:jira:API-77', text: 'Ask for a review on PR #88.' },
        { itemId: 'ticket:jira:API-77', text: 'Repeated.' },
        { itemId: 'ticket:linear:WEB-433', text: '   ' },
      ],
      flagged,
    );
    expect(items).toEqual([{ itemId: 'ticket:jira:API-77', text: 'Ask for a review on PR #88.' }]);
  });
});

describe('parseDigestReply with flagged tickets', () => {
  const stats: DigestStats = { finished: 0, waiting: 0, failedOrStalled: 0, costUsd: null };

  it('accepts a brief with items and no chat lines', () => {
    const reply = JSON.stringify({
      headline: 'Two tickets need you.',
      lines: [],
      items: [{ itemId: 'ticket:linear:WEB-433', text: 'Start WEB-433 with a plan.' }],
    });
    const body = parseDigestReply(reply, new Set(), stats, flagged);
    expect(body).toMatchObject({
      headline: 'Two tickets need you.',
      lines: [],
      items: [{ itemId: 'ticket:linear:WEB-433', text: 'Start WEB-433 with a plan.' }],
      structured: true,
    });
  });
});
