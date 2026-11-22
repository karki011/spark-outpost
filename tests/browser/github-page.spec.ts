import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { rail } from './browser-view-support.ts';
import { connectorCard } from './connector-cards.ts';
import { resetTestDatabase } from './database.ts';
import { inbox, ITEMS, pull, stubInbox } from './github-page-support.ts';
import { clickSettings } from './rail-menu.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('GitHub page sorts pull requests into groups, opens details and marks them seen', async ({
  page,
}) => {
  const calls = await stubInbox(page, inbox());
  await page.goto('/');
  const item = rail(page).getByRole('button', { name: /^GitHub/ });
  await expect(item.getByLabel('New pull request activity')).toBeVisible();
  await item.click();

  const main = page.getByRole('main', { name: 'GitHub' });
  const tiles = main.getByRole('radiogroup', { name: 'Pull request groups' });
  const review = tiles.getByRole('radio', { name: /^Review requested, 4,/ });
  await expect(review).toHaveAccessibleName('Review requested, 4, 1 new');
  await expect(review).toHaveAttribute('aria-checked', 'true');

  const list = main.getByRole('list', { name: 'Review requested' });
  const rows = list.locator('.gh-main');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Fix timezone in export filenames');
  const bots = list.getByRole('button', { name: /Dependency updates/ });
  await expect(bots).toHaveAttribute('aria-expanded', 'false');
  await bots.click();
  await expect(list.getByText('Bump zod')).toBeVisible();

  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('button', { name: /Add audit log table/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  expect(calls.seen).toEqual([]);
  await page.keyboard.press('Enter');
  const pane = main.getByRole('complementary', { name: 'Fix timezone in export filenames' });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/acme/api/pull/1',
  );
  await expect.poll(() => calls.seen).toEqual([{ id: 'acme/api#1', headSha: '1'.repeat(40) }]);
  await expect(rows.first().locator('.gh-dot')).not.toHaveAttribute('data-on');

  await page.keyboard.press('ArrowDown');
  await expect(main.getByRole('complementary', { name: 'Add audit log table' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Open ticket API-198 in Tickets' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(main.getByRole('complementary')).toHaveCount(0);
  await expect(list.getByRole('button', { name: /Add audit log table/ })).toBeFocused();

  await review.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tiles.getByRole('radio', { name: /^Needs fixes/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(main.getByRole('list', { name: 'Needs fixes' })).toContainText('Failing');

  await main.getByRole('button', { name: 'Time window' }).click();
  await page.getByRole('menuitemradio', { name: 'Last 30 days' }).click();
  await expect.poll(() => calls.window).toEqual([{ windowDays: 30 }]);

  const audit = await new AxeBuilder({ page }).include('.gh').analyze();
  expect(audit.violations).toEqual([]);
});

test('GitHub page fits narrow, medium and wide windows', async ({ page }) => {
  await stubInbox(page, inbox());
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await expect(main.locator('.gh-main').first()).toBeVisible();
  for (const width of [1440, 1000, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await main.locator('.gh-main').first().click();
    const pane = main.getByRole('complementary');
    await expect(pane).toBeVisible();
    await pane.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    await expect(main.getByRole('link', { name: 'Open on GitHub' }).first()).toBeInViewport();
    const overflow = await page.evaluate(() => {
      const page = document.querySelector('.gh')!;
      return {
        page: page.scrollWidth - page.clientWidth,
        list:
          document.querySelector('.gh-list')!.scrollWidth -
          document.querySelector('.gh-list')!.clientWidth,
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect({ width, ...overflow }).toEqual({ width, page: 0, list: 0, document: 0 });
    await page.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
  }
});

test('GitHub page keeps details beside the list after Connectors was opened', async ({ page }) => {
  await stubInbox(page, inbox());
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await expect(main.locator('.gh-main').first()).toBeVisible();
  await clickSettings(page);
  await page.getByRole('tab', { name: 'Connectors' }).click();
  await expect(connectorCard(page, 'github')).toBeVisible();
  await page.keyboard.press('Escape');
  await main.locator('.gh-main').first().click();
  const pane = main.getByRole('complementary');
  await expect(pane).toBeVisible();
  await pane.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const list = (await main.getByRole('region', { name: 'Pull requests' }).boundingBox())!;
  const detail = (await pane.boundingBox())!;
  expect(detail.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
  expect(Math.abs(detail.y - list.y)).toBeLessThanOrEqual(1);
});

test('GitHub page opens a wide project menu that stays inside the window', async ({ page }) => {
  await stubInbox(page, inbox());
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  for (const width of [1440, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await main.getByRole('button', { name: 'Project' }).click();
    const all = page.getByRole('menuitemradio', { name: 'All projects' });
    await expect(all).toBeVisible();
    const panel = page.locator('.choice-menu.gh-project-menu');
    await panel.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    const menu = (await panel.boundingBox())!;
    expect(menu.width).toBeGreaterThanOrEqual(320);
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(all).toBeHidden();
  }
});

test('GitHub page points to Connectors when GitHub is not connected', async ({ page }) => {
  await stubInbox(page, inbox({ connected: false, items: [] }));
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await expect(main.getByRole('heading', { name: 'See your pull requests here' })).toBeVisible();
  await expect(main.getByRole('radiogroup')).toHaveCount(0);
  await expect(rail(page).getByLabel('New pull request activity')).toHaveCount(0);
  await main.getByRole('button', { name: 'Open Connectors' }).click();
  await expect(page.getByRole('dialog', { name: 'Connectors' })).toBeVisible();
});

test('GitHub page lists problems and still shows the last pull requests', async ({ page }) => {
  await stubInbox(
    page,
    inbox({ problems: [{ repo: 'acme/web', message: 'Rate limited; showing earlier results' }] }),
  );
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await expect(main.getByRole('status').filter({ hasText: 'acme/web' })).toContainText(
    'Rate limited',
  );
  await expect(main.locator('.gh-main').first()).toBeVisible();
});

test('GitHub page stays usable while a refresh waits on GitHub', async ({ page }) => {
  await stubInbox(page, inbox());
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fresh = inbox({ items: [pull('9', { title: 'Arrived while waiting' }), ...ITEMS] });
  await page.route(/\/api\/github\/inbox\?refresh=1$/, async (route) => {
    await held;
    await route.fulfill({ json: fresh });
  });
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  const rows = main.locator('.gh-main');
  await expect(rows.first()).toBeVisible();

  await main.getByRole('button', { name: 'Refresh pull requests' }).click();
  await expect(main.getByText('Refreshing…')).toBeVisible();
  await expect(main.getByRole('status', { name: /Loading/ })).toHaveCount(0);
  await rows.first().click();
  await expect(
    main.getByRole('complementary', { name: 'Fix timezone in export filenames' }),
  ).toBeVisible();
  await main
    .getByRole('radiogroup', { name: 'Pull request groups' })
    .getByRole('radio', { name: /^Needs fixes/ })
    .click();
  await expect(main.getByRole('list', { name: 'Needs fixes' })).toContainText('Retry webhooks');

  release();
  await expect(main.getByText('Refreshing…')).toHaveCount(0);
  await main
    .getByRole('radiogroup', { name: 'Pull request groups' })
    .getByRole('radio', { name: /^Review requested/ })
    .click();
  await expect(main.getByRole('list', { name: 'Review requested' })).toContainText(
    'Arrived while waiting',
  );
});

test('GitHub page picks up new pull requests by itself every two minutes', async ({ page }) => {
  let body = inbox();
  let reads = 0;
  await page.route(/\/api\/github\/inbox$/, (route) => {
    reads += 1;
    return route.fulfill({ json: body });
  });
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.goto('/');
  const list = page
    .getByRole('main', { name: 'GitHub' })
    .getByRole('list', { name: 'Review requested' });
  await expect(list.locator('.gh-main').first()).toBeVisible();
  const before = reads;

  body = inbox({ items: [pull('9', { title: 'Opened a minute ago' }), ...ITEMS] });
  await page.clock.fastForward(60_000);
  expect(reads).toBe(before);
  await page.clock.fastForward(61_000);
  await expect(list).toContainText('Opened a minute ago');
});
