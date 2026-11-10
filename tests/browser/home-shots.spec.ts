import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import { seedChats } from './sidebar-seed.ts';
import { connectTickets, openTickets, resetTicketFakes, seedAssignedSince } from './ticket-seed.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const THEMES = ['light', 'graphite'] as const;
const MOCKUP = pathToFileURL(path.resolve('docs/design/tickets/home-brief-mockup.html')).href;

async function useTheme(page: Page, theme: string) {
  await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

async function shoot(page: Page, name: string) {
  for (const theme of THEMES) {
    await useTheme(page, theme);
    await page.screenshot({ path: path.join(SHOTS, `home-${name}-${theme}.png`) });
  }
}

async function goHome(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
}

async function seedBusyChats() {
  const [, , , , running] = await seedChats([
    { title: 'Current chat' },
    {
      title: 'Fix login redirect loop',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Run tests', command: 'pnpm test' },
    },
    {
      title: 'Migrate billing tables',
      run: { status: 'failed', error: 'Migration 0042 failed.' },
      unread: true,
    },
    { title: 'Add dark mode tokens', run: { status: 'succeeded' }, unread: true },
    { title: 'Tidy the webhook retry queue', run: { status: 'running' } },
  ]);
  await decorateLatestRun(running!, {
    provider: 'claude',
    step: 'Running the tests',
    plan: ['completed', 'completed', 'in_progress', 'pending', 'pending'],
  });
}

test('Home screenshots', async ({ page }) => {
  test.skip(!SHOTS, 'Set SPARK_SHOTS to a folder to write the screenshots.');
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1500 });

  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
  await seedBusyChats();
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'tickets'));
  await connectTickets(page);
  await seedAssignedSince([['WEB-433', 3]]);
  await openTickets(page);
  await expect(page.locator('li[data-ticket$=":WEB-433"]')).toBeVisible({ timeout: 15_000 });
  await goHome(page);
  const today = page.getByRole('region', { name: /^(Needs you|Pick up next)/ });
  await expect(
    today.getByRole('list', { name: /^(Do these first|Pick up where you left off)$/ }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, 'today');
  await today.getByRole('button', { name: /^Show what happened/ }).click();
  await page.getByRole('region', { name: 'Since you left' }).getByRole('button').first().focus();
  await shoot(page, 'row-action-away');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Tickets/ })
    .click();
  await expect(page.locator('.tk .brief li').first()).toBeVisible({ timeout: 15_000 });
  for (const theme of THEMES) {
    await useTheme(page, theme);
    await page.screenshot({ path: path.join(SHOTS, `tickets-brief-strip-${theme}.png`) });
  }

  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Migrate billing tables', run: { status: 'failed', error: 'Migration 0042 failed.' } },
    { title: 'Refactor webhook signer', run: { status: 'succeeded' } },
  ]);
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'home'));
  await page.goto('/');
  await expect(page.locator('.dg-headline')).toBeVisible({ timeout: 15_000 });
  await shoot(page, 'no-tickets');

  await page.request.patch('/api/tickets/attention-settings', { data: { briefEnabled: false } });
  await page.reload();
  await expect(page.locator('.dg-off')).toBeVisible();
  await shoot(page, 'brief-off');

  await page.route('**/api/conversations', () => new Promise(() => {}));
  await page.reload();
  await expect(page.getByTestId('home-lead-skeleton')).toBeVisible();
  await shoot(page, 'loading');
  await page.unroute('**/api/conversations');

  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Explain the checklist', run: { status: 'succeeded' } }]);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('All quiet.');
  await shoot(page, 'quiet');

  await resetTestDatabase({ onboarded: true });
  await seedBusyChats();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Since you left' })).toBeVisible();
  await shoot(page, 'since');

  await page.setViewportSize({ width: 390, height: 1400 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Since you left' })).toBeVisible();
  await shoot(page, 'narrow');
});

test('Home mockup screenshots', async ({ page }) => {
  test.skip(!SHOTS, 'Set SPARK_SHOTS to a folder to write the screenshots.');
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1500 });
  for (const [state, name] of [
    ['', 'today'],
    ['no-tickets', 'no-tickets'],
    ['all-quiet', 'quiet'],
    ['off', 'brief-off'],
    ['loading', 'loading'],
  ]) {
    for (const theme of ['light', 'dark']) {
      await page.goto(`${MOCKUP}?frame=1&theme=${theme}#${state}`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, `mockup-${name}-${theme}.png`) });
    }
  }
});
