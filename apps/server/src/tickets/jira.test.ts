import { describe, expect, it } from 'vitest';
import { assignedJql, jqlString } from './jira.ts';

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
