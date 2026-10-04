import { describe, expect, it } from 'vitest';
import type { InboxTicket, TicketSection } from '@spark-outpost/contracts';
import type { LiveTicket } from './ticket-flow.ts';
import { nextViewIndex, parseView, viewItems } from './ticket-views.ts';

function entry(
  key: string,
  section: TicketSection,
  snoozedUntil: string | null = null,
): LiveTicket {
  const ticket = {
    source: 'linear',
    key,
    section,
    snooze: snoozedUntil ? { until: snoozedUntil, rules: [] } : null,
  } as unknown as InboxTicket;
  return { ticket, section, line: '', tone: 'none', chat: null };
}

const ENTRIES = [
  entry('WEB-1', 'attention'),
  entry('WEB-2', 'attention'),
  entry('WEB-3', 'spark'),
  entry('WEB-4', 'up_next'),
  entry('WEB-5', 'done'),
];

describe('ticket views', () => {
  it('lists Inbox and every flow group with its live count, empty groups included', () => {
    expect(viewItems(ENTRIES, 'inbox')).toEqual([
      { id: 'inbox', label: 'Inbox', count: 5 },
      { id: 'attention', label: 'Needs you', count: 2 },
      { id: 'spark', label: 'In progress with Spark', count: 1 },
      { id: 'started', label: 'Started', count: 0 },
      { id: 'up_next', label: 'Up next', count: 1 },
      { id: 'review', label: 'In review / PR open', count: 0 },
      { id: 'done', label: 'Done recently', count: 1 },
    ]);
  });

  it('counts by the live group, so a ticket whose chat starts asking moves between counts', () => {
    const moved = ENTRIES.map((item) =>
      item.ticket.key === 'WEB-3' ? { ...item, section: 'attention' as const } : item,
    );
    const counts = Object.fromEntries(viewItems(moved, null).map((item) => [item.id, item.count]));
    expect(counts).toMatchObject({ inbox: 5, attention: 3, spark: 0 });
  });

  it('adds Snoozed only when something is snoozed or it is the open view', () => {
    const snoozed = [...ENTRIES, entry('WEB-6', 'review', '2026-10-05T09:00:00.000Z')];
    expect(viewItems(snoozed, 'inbox').at(-1)).toEqual({
      id: 'snoozed',
      label: 'Snoozed',
      count: 1,
    });
    expect(viewItems(ENTRIES, 'snoozed').at(-1)).toEqual({
      id: 'snoozed',
      label: 'Snoozed',
      count: 0,
    });
    expect(viewItems(ENTRIES, null).some((item) => item.id === 'snoozed')).toBe(false);
  });

  it('counts nothing when there are no tickets', () => {
    expect(viewItems([], 'inbox').every((item) => item.count === 0)).toBe(true);
  });
});

describe('the remembered view', () => {
  it('keeps a known view and falls back to Inbox for anything else', () => {
    expect(parseView('review')).toBe('review');
    expect(parseView('snoozed')).toBe('snoozed');
    expect(parseView('inbox')).toBe('inbox');
    expect(parseView('working')).toBe('inbox');
    expect(parseView(null)).toBe('inbox');
  });
});

describe('moving between views with the keyboard', () => {
  it('steps with the arrows and stops at either end', () => {
    expect(nextViewIndex('ArrowDown', 0, 7)).toBe(1);
    expect(nextViewIndex('ArrowRight', 5, 7)).toBe(6);
    expect(nextViewIndex('ArrowDown', 6, 7)).toBe(6);
    expect(nextViewIndex('ArrowUp', 0, 7)).toBe(0);
    expect(nextViewIndex('ArrowLeft', 3, 7)).toBe(2);
  });

  it('jumps with Home and End and ignores other keys', () => {
    expect(nextViewIndex('Home', 4, 7)).toBe(0);
    expect(nextViewIndex('End', 1, 7)).toBe(6);
    expect(nextViewIndex('Enter', 1, 7)).toBeNull();
    expect(nextViewIndex('End', 0, 0)).toBeNull();
  });
});
