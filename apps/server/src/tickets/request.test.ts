import { describe, expect, it } from 'vitest';
import { MESSAGE_MAX_LENGTH, type TicketDetail } from '@spark-outpost/contracts';
import { PLAN_FIRST_LINE, splitCriteria, TICKET_DATA_LINE, ticketRequest } from './request.ts';

const ticket: TicketDetail = {
  source: 'jira',
  key: 'WEB-418',
  title: 'Export the usage table as CSV',
  status: 'todo',
  statusName: 'To Do',
  url: 'https://example.atlassian.net/browse/WEB-418',
  updatedAt: '2026-09-27T12:00:00.000Z',
  project: 'WEB',
  priority: 'Medium',
  sprint: 'Sprint 41',
  description:
    'People want a spreadsheet.\n\n### Acceptance criteria\n\n- A Download CSV button\n- Columns match\n\n### Notes\n\nKeep it small.',
  assignee: 'Alex Example',
  labels: [],
  comments: [],
  links: [],
  subtasks: [
    { key: 'WEB-419', title: 'CSV header row', status: 'in_progress', statusName: 'In Progress' },
  ],
};

describe('ticket request', () => {
  it('splits acceptance criteria out of the description', () => {
    expect(splitCriteria(ticket.description)).toEqual({
      description: 'People want a spreadsheet.\n\n### Notes\n\nKeep it small.',
      criteria: '- A Download CSV button\n- Columns match',
    });
    expect(splitCriteria('**Acceptance criteria**\n1. Works')).toEqual({
      description: '',
      criteria: '1. Works',
    });
    expect(splitCriteria('Just a bug.')).toEqual({ description: 'Just a bug.', criteria: null });
  });

  it('builds the chat request from the ticket', () => {
    const text = ticketRequest(ticket, 'build');
    expect(text.split('\n')[0]).toBe('WEB-418: Export the usage table as CSV');
    expect(text).toContain(
      'Jira ticket WEB-418 (To Do): https://example.atlassian.net/browse/WEB-418',
    );
    expect(text).toContain('## Acceptance criteria\n\n- A Download CSV button');
    expect(text).toContain('- WEB-419 CSV header row (In Progress)');
    expect(text).toContain(TICKET_DATA_LINE);
    expect(text).not.toContain(PLAN_FIRST_LINE);
    expect(ticketRequest(ticket, 'plan').endsWith(PLAN_FIRST_LINE)).toBe(true);
  });

  it('stays within the message limit for huge descriptions', () => {
    const huge = { ...ticket, description: 'x'.repeat(50_000) };
    expect(ticketRequest(huge, 'plan').length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
    expect(ticketRequest(huge, 'plan')).toContain(PLAN_FIRST_LINE);
  });
});
