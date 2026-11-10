import { describe, expect, it } from 'vitest';
import { jiraSource } from './jira.ts';
import { isTruncated } from './source.ts';

const access = { siteUrl: 'https://jira.example.test', email: 'me@example.test', apiToken: 't' };
const NO_MOVES = { statusMap: {}, moveStatuses: {} };

const issue = (n: number) => ({
  key: `WEB-${n}`,
  fields: {
    summary: `Ticket ${n}`,
    status: { name: 'To Do' },
    updated: '2026-09-01T10:00:00.000+0000',
  },
});

function pagedJira(pages: number, perPage: number) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    bodies.push(body);
    const index = body.nextPageToken ? Number(body.nextPageToken) : 0;
    const issues = Array.from({ length: perPage }, (_, i) => issue(index * perPage + i + 1));
    const answer = index + 1 < pages ? { issues, nextPageToken: String(index + 1) } : { issues };
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  return { source: jiraSource(access, NO_MOVES, fetchImpl), bodies };
}

describe('Jira assigned tickets paging', () => {
  it('reads one page when Jira has no next token', async () => {
    const { source, bodies } = pagedJira(1, 3);
    const found = await source.listAssigned({});
    expect(found).toHaveLength(3);
    expect(bodies).toHaveLength(1);
    expect(isTruncated(found)).toBe(false);
  });

  it('follows the next page token in order', async () => {
    const { source, bodies } = pagedJira(3, 2);
    const found = await source.listAssigned({});
    expect(found.map((ticket) => ticket.key)).toEqual([
      'WEB-1',
      'WEB-2',
      'WEB-3',
      'WEB-4',
      'WEB-5',
      'WEB-6',
    ]);
    expect(bodies.map((body) => body.nextPageToken)).toEqual([undefined, '1', '2']);
    expect(isTruncated(found)).toBe(false);
  });

  it('stops at five pages and marks the list truncated', async () => {
    const { source, bodies } = pagedJira(9, 2);
    const found = await source.listAssigned({});
    expect(bodies).toHaveLength(5);
    expect(found).toHaveLength(10);
    expect(isTruncated(found)).toBe(true);
  });

  it('is not truncated when the last allowed page is the final one', async () => {
    const { source } = pagedJira(5, 2);
    expect(isTruncated(await source.listAssigned({}))).toBe(false);
  });
});
