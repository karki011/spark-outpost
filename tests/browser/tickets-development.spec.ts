import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { FakeDevPull } from '../../apps/server/test/fake-jira-dev.ts';
import { repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { resetTestDatabase } from './database.ts';
import { seedFlowChats } from './ticket-flow-seed.ts';
import {
  connectTickets,
  openTickets,
  resetTicketFakes,
  seedJiraDevelopment,
  setJiraDevStatus,
  STUB_URL,
} from './ticket-seed.ts';
import { FAKE_GH_STATE } from './stub-config.ts';

const SHOTS = process.env.TICKET_DEV_SHOTS ?? '';
const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const detailOf = (page: Page, key: string) =>
  page.getByRole('complementary', { name: `${key} details` });
const development = (page: Page, key: string) =>
  detailOf(page, key).getByRole('region', { name: 'Development' });
async function sectionOf(page: Page, key: string): Promise<string | undefined> {
  const inbox = (await (await page.request.get('/api/tickets/inbox')).json()) as {
    tickets: { key: string; section: string }[];
  };
  return inbox.tickets.find((ticket) => ticket.key === key)?.section;
}

test.describe.configure({ timeout: 90_000 });
let base = '';

test.beforeEach(async ({ page, request }) => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
  await request.post(`${STUB_URL}/github-test/reset`);
  base = mkdtempSync(path.join(os.tmpdir(), 'spark-ticket-dev-'));
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => {
  rmSync(FAKE_GH_STATE, { force: true });
  rmSync(base, { recursive: true, force: true });
});

const jiraPull = (number: number, fields: Partial<FakeDevPull> = {}): FakeDevPull => ({
  number,
  title: `API-84 Document the webhook retries (${number})`,
  url: `https://github.com/acme/api/pull/${number}`,
  status: 'OPEN',
  branch: 'API-84-webhook-retries',
  author: 'Sam Ortiz',
  lastUpdate: new Date(Date.now() - 10 * 60_000).toISOString(),
  repositoryName: 'acme/api',
  ...fields,
});

async function linkInJira() {
  await seedJiraDevelopment('API-84', {
    pullRequests: [jiraPull(52), jiraPull(50, { status: 'MERGED' })],
    branches: [
      {
        name: 'API-84-webhook-retries',
        url: 'https://github.com/acme/api/tree/API-84-webhook-retries',
        repositoryName: 'acme/api',
      },
    ],
    commits: { count: 2, lastUpdated: new Date(Date.now() - 10 * 60_000).toISOString() },
    builds: { count: 1, failed: 0, successful: 1 },
  });
}

async function shoot(target: Locator, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

async function open(page: Page, key: string) {
  await connectTickets(page, ['jira']);
  await openTickets(page);
  await expect(row(page, key)).toBeVisible({ timeout: 15_000 });
}

test('a pull request linked in Jira shows on the row and in Development, with Jira as the status source', async ({
  page,
}) => {
  await linkInJira();
  await open(page, 'API-84');

  const badge = row(page, 'API-84').getByRole('button', {
    name: 'Open PR #52 for API-84, open and 1 more, in your browser',
  });
  await expect(badge).toContainText('#52');
  await expect(badge).toContainText('+1');
  await expect(row(page, 'API-84')).toContainText('PR #52 in review');
  expect(await sectionOf(page, 'API-84')).toBe('review');
  await shoot(row(page, 'API-84'), 'row-linked');

  await row(page, 'API-84').locator('.ir-main').click();
  const section = development(page, 'API-84');
  const pulls = section.getByRole('list', { name: 'Pull requests' }).getByRole('link');
  await expect(pulls).toHaveCount(2);
  await expect(pulls.first()).toHaveAttribute('href', 'https://github.com/acme/api/pull/52');
  await expect(pulls.first()).toHaveAttribute('target', '_blank');
  await expect(pulls.first()).toContainText('API-84 Document the webhook retries (52)');
  await expect(pulls.first()).toContainText('acme/api #52 · Open');
  await expect(pulls.first()).toContainText('Linked in Jira · Status from Jira');
  await expect(pulls.nth(1)).toContainText('Merged');
  const branch = section.getByRole('link', { name: 'API-84-webhook-retries' });
  await expect(branch).toHaveAttribute(
    'href',
    'https://github.com/acme/api/tree/API-84-webhook-retries',
  );
  const activity = section.getByRole('list', { name: 'Commits and builds' });
  await expect(activity).toContainText('2 commits');
  await expect(activity).toContainText('last 10 min ago');
  await expect(activity).toContainText('1 build passing');

  await pulls.first().focus();
  await page.keyboard.press('Tab');
  await expect(pulls.nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(branch).toBeFocused();
  await shoot(detailOf(page, 'API-84'), 'detail-linked');

  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const results = await new AxeBuilder({ page })
      .include('.tk-detail')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    found.push(...results.violations.map((violation) => `${scheme}: ${violation.id}`));
  }
  expect(found).toEqual([]);
});

test('text from Jira is shown as plain text', async ({ page }) => {
  await seedJiraDevelopment('API-84', {
    pullRequests: [jiraPull(52, { title: '<img src=x onerror=alert(1)><b>bold</b>' })],
    branches: [
      {
        name: '<script>alert(1)</script>',
        url: 'https://github.com/acme/api/tree/x',
        repositoryName: 'acme/api',
      },
    ],
  });
  await open(page, 'API-84');
  await row(page, 'API-84').locator('.ir-main').click();
  const section = development(page, 'API-84');
  await expect(section.getByRole('link', { name: /#52/ })).toContainText(
    '<img src=x onerror=alert(1)><b>bold</b>',
  );
  await expect(section.getByRole('link', { name: '<script>alert(1)</script>' })).toBeVisible();
  await expect(section.locator('img, script, b b')).toHaveCount(0);
});

test("Spark's own pull request is listed once, a teammate's is tagged, and a key match is marked", async ({
  page,
  request,
}) => {
  const repo = await repoWithRemote(base, 'widgets');
  writeFileSync(FAKE_GH_STATE, 'octo-cli');
  expect((await page.request.post('/api/projects', { data: { rootPath: repo.root } })).ok()).toBe(
    true,
  );
  await request.post(`${STUB_URL}/github-test/pulls`, {
    data: {
      number: 342,
      title: 'API-77 follow-up',
      openedBy: 'sam-teammate',
      reviews: [{ user: { login: 'rev' }, state: 'APPROVED' }],
      checkRuns: [{ name: 'unit', status: 'completed', conclusion: 'failure' }],
    },
  });
  await request.post(`${STUB_URL}/github-test/pulls`, {
    data: {
      number: 77,
      title: 'Document retries',
      head: 'docs/api-84-retries',
      created_at: new Date().toISOString(),
    },
  });
  const widgets = (number: number) => ({
    url: `https://github.com/acme/widgets/pull/${number}`,
    repositoryName: 'acme/widgets',
  });
  await seedJiraDevelopment('API-77', {
    pullRequests: [
      jiraPull(341, { ...widgets(341), title: 'Rate limit headers' }),
      jiraPull(342, { ...widgets(342), title: 'API-77 follow-up' }),
    ],
  });
  await connectTickets(page, ['jira']);
  await seedFlowChats([
    {
      key: 'API-77',
      source: 'jira',
      status: 'succeeded',
      pull: { number: 341, checks: 'passing' },
    },
  ]);
  await openTickets(page);
  await expect(row(page, 'API-77')).toBeVisible({ timeout: 15_000 });

  await expect(
    row(page, 'API-77').getByRole('button', { name: /^Open PR #341 for API-77, .* and 1 more/ }),
  ).toBeVisible();
  await row(page, 'API-77').locator('.ir-main').click();
  const pulls = development(page, 'API-77')
    .getByRole('list', { name: 'Pull requests' })
    .getByRole('link');
  await expect(pulls).toHaveCount(2);
  await expect(pulls.first()).toContainText('#341');
  await expect(pulls.first()).toContainText('Spark chat');
  await expect(pulls.first()).toContainText('Checks passing');
  await expect(pulls.nth(1)).toContainText('Linked in Jira');
  await expect(pulls.nth(1)).toContainText('Approved');
  await expect(pulls.nth(1)).toContainText('Failed: unit');
  await expect(pulls.nth(1)).not.toContainText('Status from Jira');
  await expect(row(page, 'API-77')).not.toContainText('approved');

  await expect(row(page, 'API-84')).toContainText('PR #77');
  expect(await sectionOf(page, 'API-84')).toBe('review');
  await row(page, 'API-84').locator('.ir-main').click();
  const matched = development(page, 'API-84').getByRole('link', { name: /#77/ });
  await expect(matched).toContainText('Matched by key');
  await expect(matched).toHaveAttribute('href', 'https://github.com/acme/widgets/pull/77');
  await shoot(detailOf(page, 'API-84'), 'detail-matched');
});

test('tickets still load when Jira does not give development information', async ({ page }) => {
  await setJiraDevStatus('forbidden');
  await open(page, 'API-84');
  await expect(row(page, 'API-84').locator('.irl-pr')).toHaveCount(0);
  await row(page, 'API-84').locator('.ir-main').click();
  await expect(development(page, 'API-84')).toContainText(
    'Development info unavailable from Jira.',
  );
  await expect(detailOf(page, 'API-84')).toContainText('Document the webhook retries');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await shoot(development(page, 'API-84'), 'detail-unavailable');
});

test('the Development section fits a phone', async ({ page }) => {
  await linkInJira();
  await open(page, 'API-84');
  await row(page, 'API-84').locator('.ir-main').click();
  await expect(development(page, 'API-84')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const section = development(page, 'API-84');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('link', { name: /#52/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = (await section.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await shoot(detailOf(page, 'API-84'), 'detail-phone');
});
