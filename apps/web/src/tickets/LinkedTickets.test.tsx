// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { TicketDetail } from '@spark-outpost/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkedTickets } from './LinkedTickets.tsx';

afterEach(cleanup);

const row = (key: string, title: string, relation?: string) => ({
  key,
  title,
  status: 'todo' as const,
  statusName: 'To Do',
  url: `https://acme.atlassian.net/browse/${key}`,
  ...(relation ? { relation } : {}),
});

function ticket(extra: Partial<TicketDetail>): TicketDetail {
  return {
    source: 'jira',
    key: 'WEB-1',
    title: 'Export CSV',
    status: 'in_progress',
    statusName: 'In Progress',
    url: 'https://acme.atlassian.net/browse/WEB-1',
    updatedAt: '2026-09-27T12:00:00.000Z',
    project: 'WEB',
    priority: null,
    sprint: null,
    priorityRank: 0,
    assignedTo: null,
    labels: [],
    dueDate: null,
    doneAt: null,
    reporter: null,
    createdAt: null,
    description: '',
    assignee: null,
    comments: [],
    links: [],
    subtasks: [],
    ...extra,
  };
}

describe('LinkedTickets', () => {
  it('groups the parent, subtasks and links by relation', () => {
    render(
      <LinkedTickets
        ticket={ticket({
          parent: row('WEB-100', 'CSV epic'),
          subtasks: [row('WEB-2', 'Header row')],
          subtasksMore: true,
          relations: [
            { ...row('WEB-7', 'Ship the report'), relation: 'blocks' },
            { ...row('WEB-8', 'Docs'), relation: 'blocks' },
            { ...row('API-9', 'Endpoint'), relation: 'is blocked by' },
          ],
        })}
        loaded={new Set()}
        onOpen={vi.fn()}
      />,
    );

    const headings = screen.getAllByRole('heading', { level: 5 }).map((h) => h.textContent);
    expect(headings).toEqual(['Parent', 'Subtasks', 'Blocks', 'Is blocked by']);
    const blocks = screen.getByRole('heading', { name: 'Blocks' }).parentElement!;
    expect(
      within(blocks)
        .getAllByText(/^WEB-/)
        .map((key) => key.textContent),
    ).toEqual(['WEB-7', 'WEB-8']);
    expect(within(blocks).getAllByText('To Do')).toHaveLength(2);
    expect(screen.getByText('There are more subtasks than listed here.')).toBeTruthy();
  });

  it('shows nothing when there is no parent, subtask or link', () => {
    const { container } = render(
      <LinkedTickets ticket={ticket({ relations: [] })} loaded={new Set()} onOpen={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('selects a ticket that is in the loaded inbox and links out to one that is not', () => {
    const onOpen = vi.fn();
    render(
      <LinkedTickets
        ticket={ticket({
          parent: row('WEB-100', 'CSV epic'),
          relations: [{ ...row('API-9', 'Endpoint'), relation: 'relates to' }],
        })}
        loaded={new Set(['jira:WEB-100'])}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /WEB-100/ }));
    expect(onOpen).toHaveBeenCalledWith('jira', 'WEB-100');

    const external = screen.getByRole('link', { name: /API-9/ });
    expect(external.getAttribute('href')).toBe('https://acme.atlassian.net/browse/API-9');
    expect(external.getAttribute('target')).toBe('_blank');
    expect(external.getAttribute('rel')).toContain('noreferrer');
    expect(screen.queryByRole('link', { name: /WEB-100/ })).toBeNull();
  });

  it('never links an address that is not http or https', () => {
    render(
      <LinkedTickets
        ticket={ticket({
          relations: [
            { ...row('API-9', 'Endpoint'), url: 'javascript:alert(1)', relation: 'blocks' },
          ],
        })}
        loaded={new Set()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('API-9')).toBeTruthy();
  });
});
