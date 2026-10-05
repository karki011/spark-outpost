import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import { seedFlowChats, setPullChecks, type PullChecks } from './ticket-flow-seed.ts';
import { connectTickets, openTickets, resetTicketFakes, STUB_URL } from './ticket-seed.ts';
import { FAKE_GH_STATE } from './stub-config.ts';

const SHOTS = process.env.SPARK_TICKET_SHOTS;

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const section = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const views = (page: Page) => main(page).getByRole('navigation', { name: 'Ticket views' });
const detailOf = (page: Page, key: string) =>
  page.getByRole('complementary', { name: `${key} details` });
const ciBadge = (page: Page, key: string) => row(page, key).locator('.fchip.ci');
const noticeDot = (page: Page) => rail(page).getByLabel(/ticket updates? to look at/);

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ request }) => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
  await request.post(`${STUB_URL}/github-test/reset`);
});

test.afterEach(() => rmSync(FAKE_GH_STATE, { force: true }));

async function seedReview(page: Page, checks: PullChecks) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await connectTickets(page);
  await page.request.get('/api/tickets/inbox');
  await seedFlowChats([
    { key: 'WEB-418', source: 'linear', status: 'succeeded', pull: { number: 342, checks } },
  ]);
}

test('failing checks stay in In review as a badge and are seen once the ticket is opened', async ({
  page,
}) => {
  await seedReview(page, 'failing');
  await openTickets(page);

  const reviewing = section(page, 'In review / PR open');
  await expect(reviewing).toContainText('WEB-418', { timeout: 15_000 });
  await expect(section(page, 'Needs you')).not.toContainText('WEB-418');
  await expect(row(page, 'WEB-418').locator('.why-r')).toHaveText('PR #342Checks failing, new');
  await expect(ciBadge(page, 'WEB-418')).toHaveClass(/blocked/);
  await expect(row(page, 'WEB-418').locator('.sev.bad')).toHaveCount(0);
  await expect(rail(page).getByLabel('2 tickets need attention')).toBeVisible();
  await expect(noticeDot(page)).toHaveAccessibleName('1 ticket update to look at');

  await row(page, 'WEB-418').locator('.ir-main').click();
  const detail = detailOf(page, 'WEB-418');
  await expect(detail).toBeVisible();
  await expect(detail).not.toContainText('Why it needs attention');
  await expect(detail.getByRole('button', { name: 'Remind me later' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: /^Dismiss/ })).toHaveCount(0);
  const pulls = detail.getByRole('region', { name: 'Pull requests' });
  const pull = pulls.getByRole('link', { name: /#342/ });
  await expect(pull).toContainText('Open');
  await expect(pull).toContainText('Checks failing');
  await expect(pull).toContainText('Failed: unit');
  await expect(pull.locator('.irl-pr.bad')).toHaveCount(0);
  const pullsTop = (await pulls.boundingBox())!.y;
  const propsTop = (await detail.locator('.tk-props').boundingBox())!.y;
  expect(pullsTop).toBeLessThan(propsTop);

  await expect(ciBadge(page, 'WEB-418')).toHaveText('Checks failing');
  await expect(noticeDot(page)).toHaveCount(0);
  await page.reload();
  await expect(ciBadge(page, 'WEB-418')).toHaveText('Checks failing', { timeout: 15_000 });
  await expect(noticeDot(page)).toHaveCount(0);

  await setPullChecks(342, 'failing', 'sha-second-push');
  await main(page).getByRole('button', { name: 'Refresh tickets' }).click();
  await expect(ciBadge(page, 'WEB-418')).toHaveText('Checks failing, new', { timeout: 20_000 });
  await expect(noticeDot(page)).toBeVisible();
});

test('opening the pull request from the row marks the notice seen', async ({ page }) => {
  await seedReview(page, 'failing');
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await openTickets(page);
  await expect(ciBadge(page, 'WEB-418')).toHaveText('Checks failing, new', { timeout: 15_000 });
  await row(page, 'WEB-418')
    .getByRole('button', { name: /^Open PR #342 for WEB-418/ })
    .click();
  await expect(ciBadge(page, 'WEB-418')).toHaveText('Checks failing');
  await expect(noticeDot(page)).toHaveCount(0);
});

test('checks that are still running show as running and raise no notice', async ({ page }) => {
  await seedReview(page, 'pending');
  await openTickets(page);
  await expect(ciBadge(page, 'WEB-418')).toHaveText('Checks running', { timeout: 15_000 });
  await expect(ciBadge(page, 'WEB-418')).toHaveClass(/todo/);
  await expect(section(page, 'In review / PR open')).toContainText('WEB-418');
  await expect(noticeDot(page)).toHaveCount(0);
});

test('Dismiss clears a Needs you row by keyboard and Undo brings it back', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await connectTickets(page);
  await openTickets(page);
  await expect(section(page, 'Needs you')).toContainText('API-81', { timeout: 15_000 });
  await row(page, 'API-81').locator('.ir-main').click();
  const detail = detailOf(page, 'API-81');
  await expect(detail.getByRole('button', { name: 'Remind me later' })).toBeVisible();
  const dismiss = detail.getByRole('button', { name: 'Dismiss API-81 from Needs you' });
  await expect(dismiss).toHaveText('Dismiss');
  await dismiss.focus();
  await page.keyboard.press('Enter');

  await expect(section(page, 'Needs you')).not.toContainText('API-81');
  await expect(row(page, 'API-81')).toBeVisible();
  await expect(row(page, 'API-81').locator('.snz-tag')).toHaveCount(0);
  await expect(views(page).getByRole('button', { name: /^Snoozed/ })).toHaveCount(0);
  await expect(detail).not.toContainText('Why it needs attention');
  await expect(rail(page).getByLabel('1 ticket needs attention')).toBeVisible();
  const toast = main(page).getByRole('status').filter({ hasText: 'Dismissed API-81' });
  await expect(toast).toContainText('It comes back if something changes.');

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(section(page, 'Needs you')).toContainText('API-81');
  await expect(rail(page).getByLabel('2 tickets need attention')).toBeVisible();
});

test('the notice states have no accessibility issues and can be captured in light and dark', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedReview(page, 'failing');
  await openTickets(page);
  await expect(ciBadge(page, 'WEB-418')).toBeVisible({ timeout: 15_000 });
  await views(page)
    .getByRole('button', { name: /^In review/ })
    .click();

  const found: string[] = [];
  const check = async (label: string) => {
    const results = await new AxeBuilder({ page })
      .include('main.tk')
      .include('nav.rail')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    found.push(...results.violations.map((violation) => `${label}: ${violation.id}`));
  };
  const shoot = async (name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await check(`row ${theme}`);
    await shoot(`in-review-row-${theme}`);
  }
  await row(page, 'WEB-418').locator('.ir-main').click();
  await expect(detailOf(page, 'WEB-418').getByText('Failed: unit')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await check(`detail ${theme}`);
    await shoot(`detail-${theme}`);
  }
  expect(found).toEqual([]);
});
