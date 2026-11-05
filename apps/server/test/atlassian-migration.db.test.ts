import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo } from './migration-support.ts';

const ATLASSIAN_MIGRATION = '0188_atlassian_products.sql';

describe('upgrading a Jira connection to Atlassian', () => {
  const state = migratedUpTo(ATLASSIAN_MIGRATION);

  it('keeps Jira on, leaves Confluence off and unchecked, and asks for nothing new', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      `INSERT INTO ticket_connections (workspace_id, source, api_url, email, account, account_id)
       VALUES ($1, 'jira', 'https://acme.atlassian.net', 'alex@example.test', 'alex@example.test',
         'acc-1'),
         ($1, 'linear', 'https://api.linear.app/graphql', NULL, 'Alex', 'user-1')`,
      [workspaceId],
    );
    await runMigrations(db);

    const { rows } = await db.query(
      `SELECT source, api_url, email, account_id, jira_on, jira_reach, confluence_on,
         confluence_reach FROM ticket_connections ORDER BY source`,
    );
    expect(rows).toEqual([
      {
        source: 'jira',
        api_url: 'https://acme.atlassian.net',
        email: 'alex@example.test',
        account_id: 'acc-1',
        jira_on: true,
        jira_reach: 'reachable',
        confluence_on: false,
        confluence_reach: null,
      },
      {
        source: 'linear',
        api_url: 'https://api.linear.app/graphql',
        email: null,
        account_id: 'user-1',
        jira_on: true,
        jira_reach: null,
        confluence_on: false,
        confluence_reach: null,
      },
    ]);
  });
});
