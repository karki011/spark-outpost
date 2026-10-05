import { describe, expect, it } from 'vitest';
import type { InboxTicket, TicketSearchResult } from '@spark-outpost/contracts';
import {
  ageTitle,
  compactAge,
  filterTickets,
  projectsOf,
  rowAction,
  safeUrl,
  searchGroup,
  snoozeChoices,
  unseenNotices,
  whose,
} from './ticket-model.ts';

const NOW = Date.parse('2026-09-28T10:00:00.000Z');
const CHAT = '00000000-0000-4000-8000-000000000001';
const PR = 'https://github.com/acme/web/pull/88';

function inbox(fields: Partial<InboxTicket> = {}): InboxTicket {
  return {
    source: 'linear',
    key: 'WEB-1',
    title: 'A ticket',
    status: 'todo',
    statusName: 'Todo',
    url: 'https://linear.app/acme/issue/WEB-1',
    updatedAt: '2026-09-27T10:00:00.000Z',
    project: 'WEB',
    priority: 'High',
    sprint: null,
    priorityRank: 2,
    assignedTo: { id: 'me', name: 'Alex' },
    labels: [],
    dueDate: null,
    doneAt: null,
    reporter: null,
    createdAt: null,
    work: [],
    section: 'up_next',
    flags: [],
    reason: 'Not started',
    tone: 'none',
    age: null,
    chat: null,
    pullRequest: null,
    lastSync: null,
    ...fields,
  };
}

const flag = (rule: InboxTicket['flags'][number]['rule']) => ({
  rule,
  key: rule,
  text: rule,
  rationale: 'Rule',
  since: null,
  severity: 'warn' as const,
});

const chat = { conversationId: CHAT, title: 'Chat', state: 'asking' as const };

describe('ticket rows', () => {
  it('shows compact ages with a spelled-out title', () => {
    expect(compactAge('2026-09-28T09:59:30.000Z', NOW)).toBe('now');
    expect(compactAge('2026-09-28T09:40:00.000Z', NOW)).toBe('20m');
    expect(compactAge('2026-09-28T07:00:00.000Z', NOW)).toBe('3h');
    expect(compactAge('2026-09-25T10:00:00.000Z', NOW)).toBe('3d');
    expect(ageTitle({ at: '2026-09-25T10:00:00.000Z', label: 'Assigned' }, NOW)).toBe(
      'Assigned 3 days ago',
    );
  });

  it('offers one action that fits the section and the lead reason', () => {
    expect(rowAction(inbox({ section: 'attention', flags: [flag('chat-asking')], chat }))).toEqual({
      kind: 'answer',
      label: 'Answer',
    });
    const withPr = inbox({
      section: 'attention',
      flags: [flag('review-slow')],
      work: [
        {
          taskId: CHAT,
          conversationId: CHAT,
          startedAt: '2026-09-20T10:00:00.000Z',
          pullRequests: [{ title: 'PR', url: PR }],
        },
      ],
    });
    expect(rowAction(withPr)).toEqual({ kind: 'open-pr', label: 'Open PR', url: PR });
    expect(rowAction(inbox({ section: 'attention', flags: [flag('sync-failed')] }))).toBeNull();
    expect(rowAction(inbox({ section: 'attention', flags: [flag('due-soon')] }))?.kind).toBe(
      'start',
    );
    expect(rowAction(inbox({ section: 'started', chat }))?.kind).toBe('open-chat');
    expect(rowAction(inbox({ section: 'review' }))).toBeNull();
    expect(rowAction(inbox({ section: 'done' }))).toBeNull();
    expect(rowAction(inbox())?.kind).toBe('start');
  });

  it('filters by source and team and lists the teams', () => {
    const tickets = [
      inbox({ key: 'WEB-1' }),
      inbox({ key: 'API-1', source: 'jira', project: 'API' }),
    ];
    expect(filterTickets(tickets, { source: 'jira', project: '' }).map((t) => t.key)).toEqual([
      'API-1',
    ]);
    expect(filterTickets(tickets, { source: 'all', project: 'WEB' }).map((t) => t.key)).toEqual([
      'WEB-1',
    ]);
    expect(projectsOf([...tickets, inbox({ project: null })])).toEqual(['API', 'WEB']);
  });

  it('groups search results by whose they are', () => {
    const result = (fields: Partial<TicketSearchResult>): TicketSearchResult => ({
      ...inbox(),
      mine: false,
      ...fields,
    });
    const others = result({ assignedTo: { id: 'u2', name: 'Jordan Lee' } });
    expect(searchGroup(result({ mine: true }))).toBe('mine');
    expect(searchGroup(result({ assignedTo: null }))).toBe('unassigned');
    expect(searchGroup(others)).toBe('others');
    expect(whose(others)).toBe('Assigned to Jordan Lee');
  });

  it('counts the notices nobody has looked at yet', () => {
    const notice = (seen: boolean) => ({ id: `${PR}@abc`, text: 'PR #1 checks failing', seen });
    expect(unseenNotices([inbox(), inbox({ notice: notice(false) })])).toBe(1);
    expect(unseenNotices([inbox({ notice: notice(true) })])).toBe(0);
  });

  it('links out only to web addresses', () => {
    expect(safeUrl(PR)).toBe(PR);
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl(null)).toBeUndefined();
  });
});

describe('snooze choices', () => {
  it('offers three hours from now, tomorrow at 9 and next Monday at 9', () => {
    const wednesday = new Date(2026, 8, 30, 14, 15);
    const [later, tomorrow, nextWeek] = snoozeChoices(wednesday);
    expect(later?.until).toEqual(new Date(2026, 8, 30, 17, 15));
    expect(tomorrow?.until).toEqual(new Date(2026, 9, 1, 9, 0));
    expect(nextWeek?.until).toEqual(new Date(2026, 9, 5, 9, 0));
  });

  it('skips to the following Monday when today is Monday', () => {
    const monday = new Date(2026, 8, 28, 8, 0);
    expect(snoozeChoices(monday)[2]?.until).toEqual(new Date(2026, 9, 5, 9, 0));
  });
});
