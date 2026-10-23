import { expect, type Locator, type Page } from '@playwright/test';
import { JIRA_EMAIL, JIRA_TOKEN } from '../../apps/server/test/fake-jira.ts';
import type { DevStatusMode, FakeDevelopment } from '../../apps/server/test/fake-jira-dev.ts';
import { LINEAR_KEY } from '../../apps/server/test/fake-linear.ts';
import { SERVICENOW_PASSWORD, SERVICENOW_USER } from '../../apps/server/test/fake-servicenow.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { createDb } from '../../apps/server/src/persistence/db.ts';
import { testDatabaseUrl } from './database.ts';
import { animationsSettled } from './settle.ts';
import { STUB_PORT } from './stub-config.ts';

export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

export async function resetTicketFakes(): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/reset`);
}

export async function seedTicketVolume(): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/volume`);
}

export async function slowTicketCreates(delayMs: number, failures = 0): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/slow-creates?delay=${delayMs}&failures=${failures}`);
}

export async function seedJiraDevelopment(
  key: string,
  development: FakeDevelopment,
): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/development`, {
    method: 'POST',
    body: JSON.stringify({ key, development }),
  });
}

export async function setJiraDevStatus(mode: DevStatusMode): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/dev-status?mode=${mode}`);
}

export async function denyJiraAssign(): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/deny-assign`);
}

export async function setJiraWorkflow(
  project: string,
  statuses: Record<string, 'new' | 'indeterminate' | 'done'>,
): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/jira-workflow`, {
    method: 'POST',
    body: JSON.stringify({ project, statuses }),
  });
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

export async function setServiceNowFaults(faults: {
  denied?: string[];
  limited?: number;
}): Promise<void> {
  await fetch(`${STUB_URL}/tickets-test/servicenow`, {
    method: 'POST',
    body: JSON.stringify(faults),
  });
}

export async function connectServiceNow(page: Page): Promise<void> {
  const response = await page.request.put('/api/tickets/connections/servicenow', {
    data: {
      source: 'servicenow',
      instanceUrl: STUB_URL,
      authKind: 'basic',
      username: SERVICENOW_USER,
      password: SERVICENOW_PASSWORD,
    },
  });
  expect(response.ok()).toBe(true);
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

export async function hoverOnceSettled(page: Page, target: Locator): Promise<void> {
  const brief = page.getByRole('region', { name: 'What needs you today' });
  await expect(brief.getByRole('list')).toBeVisible();
  await animationsSettled(page);
  await target.hover();
}
