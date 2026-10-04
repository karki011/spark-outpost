import { describe, expect, it } from 'vitest';
import { createdText, reportedText, statusBadge, statusCategory } from './ticket-status.ts';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');

describe('status badge', () => {
  it("keeps the tracker's own status name and colours it by category", () => {
    expect(statusBadge('todo', 'Ready for implementation')).toEqual({
      category: 'todo',
      label: 'Ready for implementation',
      glyph: 'circle',
    });
    expect(statusBadge('in_progress', 'Doing')).toMatchObject({ category: 'in_progress' });
    expect(statusBadge('in_review', 'Code Review')).toMatchObject({
      category: 'in_review',
      label: 'Code Review',
    });
    expect(statusBadge('done', 'Shipped')).toMatchObject({ category: 'done', glyph: 'check' });
  });

  it('marks a blocked or on-hold status, whatever group the tracker puts it in', () => {
    expect(statusCategory('in_progress', 'Blocked')).toBe('blocked');
    expect(statusCategory('todo', 'On hold')).toBe('blocked');
    expect(statusCategory('todo', 'Unblocked work')).toBe('todo');
    expect(statusCategory('done', 'Blocked')).toBe('done');
  });

  it('falls back to the plain group name when the tracker sends no name', () => {
    expect(statusBadge('in_review', ' ').label).toBe('In review');
  });
});

describe('reporter and created date', () => {
  it('says how long ago a ticket was created, then the date', () => {
    expect(createdText('2026-10-03T08:00:00.000Z', NOW)).toBe('today');
    expect(createdText('2026-10-02T08:00:00.000Z', NOW)).toBe('yesterday');
    expect(createdText('2026-09-20T12:00:00.000Z', NOW)).toBe('13 days ago');
    expect(createdText('2026-06-01T12:00:00.000Z', NOW)).toMatch(/2026/);
    expect(createdText(null, NOW)).toBeNull();
    expect(createdText('not a date', NOW)).toBeNull();
  });

  it('copes with a missing reporter or a missing date', () => {
    const reporter = { name: 'Jordan Lee' };
    expect(reportedText({ reporter, createdAt: '2026-10-02T08:00:00.000Z' }, NOW)).toBe(
      'Jordan Lee · created yesterday',
    );
    expect(reportedText({ reporter, createdAt: null }, NOW)).toBe('Jordan Lee');
    expect(reportedText({ reporter: null, createdAt: '2026-10-03T08:00:00.000Z' }, NOW)).toBe(
      'Created today',
    );
    expect(reportedText({ reporter: null, createdAt: null }, NOW)).toBeNull();
  });
});
