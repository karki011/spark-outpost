import { describe, expect, it } from 'vitest';
import { searchJql } from './jira.ts';
import { jiraExtras, jiraPriorityRank } from './jira-fields.ts';

describe('Jira search query', () => {
  it('searches text or an exact key across everyone by default', () => {
    expect(searchJql({ q: 'upload', assignee: 'anyone' })).toBe(
      'text ~ "upload" AND statusCategory != Done ORDER BY updated DESC',
    );
    expect(searchJql({ q: 'web-437', assignee: 'anyone' })).toBe(
      'key = "WEB-437" AND statusCategory != Done ORDER BY updated DESC',
    );
  });

  it('narrows by project, status and assignee', () => {
    expect(searchJql({ q: '', project: 'API', status: 'done', assignee: 'unassigned' })).toBe(
      'statusCategory = Done AND project = "API" AND assignee is EMPTY ORDER BY updated DESC',
    );
    expect(searchJql({ q: 'x', assignee: 'others' })).toBe(
      'text ~ "x" AND statusCategory != Done AND assignee != currentUser() AND assignee is not EMPTY ORDER BY updated DESC',
    );
  });
});

describe('Jira summary fields', () => {
  it('ranks priorities like Linear, from Urgent 1 to Low 4', () => {
    expect(
      ['Highest', 'High', 'Medium', 'Low', 'Lowest', 'Custom', null].map(jiraPriorityRank),
    ).toEqual([1, 2, 3, 4, 4, 0, 0]);
  });

  it('reads the assignee, due date, labels and resolution', () => {
    expect(
      jiraExtras({
        priority: { name: 'Blocker' },
        assignee: { accountId: 'acc-2', displayName: 'Jordan Lee' },
        duedate: '2026-10-06',
        labels: ['api'],
        resolutiondate: '2026-09-26T09:00:00.000+0000',
        reporter: { displayName: 'Sam Ortiz' },
        created: '2026-09-20T09:00:00.000+0000',
      }),
    ).toEqual({
      priorityRank: 1,
      assignedTo: { id: 'acc-2', name: 'Jordan Lee' },
      labels: ['api'],
      dueDate: '2026-10-06',
      doneAt: '2026-09-26T09:00:00.000Z',
      reporter: { name: 'Sam Ortiz' },
      createdAt: '2026-09-20T09:00:00.000Z',
    });
    expect(jiraExtras({ resolutiondate: 'not a date' })).toMatchObject({
      assignedTo: null,
      doneAt: null,
      reporter: null,
      createdAt: null,
    });
    expect(jiraExtras({ reporter: null, created: 'yesterday' })).toMatchObject({
      reporter: null,
      createdAt: null,
    });
  });
});
