import { describe, expect, it } from 'vitest';
import { assignedJql, jiraSource, jqlString } from './jira.ts';
import { TicketApiError } from './source.ts';

describe('Jira queries', () => {
  it('escapes quoted values', () => {
    expect(jqlString('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"');
  });

  it('builds the assigned-to-me query from filters', () => {
    expect(assignedJql({})).toBe(
      'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
    );
    expect(assignedJql({ status: 'done', project: 'WEB', q: 'csv" OR 1=1' })).toBe(
      'assignee = currentUser() AND statusCategory = Done AND project = "WEB" AND text ~ "csv\\" OR 1=1" ORDER BY updated DESC',
    );
  });
});

function answering(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

const issue = (fields: Record<string, unknown>) => ({
  key: 'WEB-1',
  fields: { summary: 'Fix it', status: { name: 'To Do' }, updated: 'yesterday-ish', ...fields },
});

const NO_MOVES = { statusMap: {}, moveStatuses: {} };
const access = { siteUrl: 'https://jira.example.test', email: 'me@example.test', apiToken: 't' };

describe('Jira answers', () => {
  it('reports an invalid date as a Jira API error', async () => {
    const list = jiraSource(access, NO_MOVES, answering({ issues: [issue({})] })).listAssigned({});
    await expect(list).rejects.toBeInstanceOf(TicketApiError);
    await expect(list).rejects.toMatchObject({ status: 502 });

    const withBadComment = issue({
      updated: '2026-09-01T10:00:00.000+0000',
      comment: { comments: [{ body: null, created: 'not a date' }] },
    });
    const detail = jiraSource(access, NO_MOVES, answering(withBadComment)).getTicket('WEB-1');
    await expect(detail).rejects.toBeInstanceOf(TicketApiError);
  });
});
