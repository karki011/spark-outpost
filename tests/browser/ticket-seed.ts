import type { Page } from '@playwright/test';
import { JIRA_EMAIL, JIRA_TOKEN } from '../../apps/server/test/fake-jira.ts';
import { LINEAR_KEY } from '../../apps/server/test/fake-linear.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { createDb } from '../../apps/server/src/persistence/db.ts';
import { testDatabaseUrl } from './database.ts';
import { STUB_PORT } from './stub-config.ts';

export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

export async function resetTicketFakes(): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/reset`);
}

export async function seedTicketVolume(): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/volume`);
}

export async function denyJiraAssign(): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/deny-assign`);
}

export async function connectTickets(page: Page, sources = ['linear', 'jira']): Promise<void> {
  if (sources.includes('linear')) {
    await page.request.put('/api/tickets/connections/linear', {
      data: { source: 'linear', apiKey: LINEAR_KEY },
    });
  }
  if (sources.includes('jira')) {
    await page.request.put('/api/tickets/connections/jira', {
      data: { source: 'jira', siteUrl: STUB_URL, email: JIRA_EMAIL, apiToken: JIRA_TOKEN },
    });
  }
}

export async function seedAssignedSince(entries: [key: string, days: number][]): Promise<void> {
  const db = createDb(testDatabaseUrl());
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    for (const [key, days] of entries) {
      await db.query(
        `INSERT INTO tickets (workspace_id, source, key, title, status, status_name, url, updated_at,
           first_seen_assigned_at)
         VALUES ($1, 'linear', $2, $2, 'todo', 'Todo', '', now(),
           now() - make_interval(days => $3))
         ON CONFLICT (workspace_id, source, key)
           DO UPDATE SET first_seen_assigned_at = EXCLUDED.first_seen_assigned_at`,
        [workspaceId, key, days],
      );
    }
  } finally {
    await db.end();
  }
}

export async function openTickets(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Tickets/ })
    .click();
}
