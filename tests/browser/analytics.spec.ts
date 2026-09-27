import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { seedAnalytics } from './analytics-seed.ts';
import { resetTestDatabase } from './database.ts';

const BLOCKING = new Set(['serious', 'critical']);

async function openAnalytics(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Analytics/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
}

async function blocking(page: Page, screen: string) {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ''))
    .map((violation) => ({
      screen,
      rule: violation.id,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}

test.describe('with three months of history', () => {
  test.beforeEach(async () => {
    await resetTestDatabase({ onboarded: true });
    await seedAnalytics();
  });

  test('shows each tab with summaries, data tables and keyboard marks', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAnalytics(page);
    const main = page.getByRole('main', { name: 'Analytics' });
    await expect(main.getByRole('region', { name: 'Harness health' })).toContainText('of 100');

    const activity = main.getByRole('region', { name: 'Activity' });
    await expect(activity.locator('.an-sum')).toContainText('turns on');
    await activity.getByRole('button', { name: 'Show data table' }).click();
    await expect(activity.getByRole('table', { name: 'Turns and spend per day' })).toBeVisible();
    await expect(activity.getByRole('button', { name: 'Hide data table' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    const days = activity.getByRole('group', { name: 'Turns per day' }).getByRole('img');
    await days.last().focus();
    await page.keyboard.press('ArrowLeft');
    await expect(days.nth((await days.count()) - 2)).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(/turn|no turns/);

    await page.getByRole('tab', { name: 'Overview' }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Spend' })).toHaveAttribute('aria-selected', 'true');
    const tree = main.getByRole('region', { name: 'Where the money went' });
    await expect(
      tree
        .getByRole('group', { name: /Spend by project/ })
        .getByRole('img')
        .first(),
    ).toHaveAttribute('aria-label', /spark-outpost|pantry-api|lumen-docs|No project/);
    await expect(main.getByRole('region', { name: 'Cost per finished turn' })).toContainText(
      'per good outcome',
    );

    await page.getByRole('tab', { name: 'Harness' }).click();
    const flow = main.getByRole('region', { name: 'Routing flow' });
    await expect(
      flow
        .getByRole('group', { name: /Routing flow/ })
        .getByRole('img')
        .first(),
    ).toHaveAttribute('aria-label', /^Request: /);
    await expect(main.getByRole('region', { name: 'Jev confidence and outcome' })).toContainText(
      '0.90 act',
    );
    await expect(
      main.getByRole('table', { name: /Where the rules and Jev picked differently/ }),
    ).toBeVisible();

    await page.getByRole('radio', { name: '7 days' }).click();
    await expect(main.locator('.an-sum').first()).toContainText('turn');
  });

  for (const theme of ['apricot', 'aurora'] as const) {
    test(`has no serious axe issues in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openAnalytics(page);
      await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
      const found = [];
      for (const tab of ['Overview', 'Spend', 'Harness']) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.locator('.an-card').first()).toBeVisible();
        const toggles = page.getByRole('button', { name: 'Show data table' });
        while ((await toggles.count()) > 0) await toggles.first().click();
        found.push(...(await blocking(page, `${theme} ${tab}`)));
      }
      expect(found).toEqual([]);
    });
  }

  test('fits a phone without horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openAnalytics(page);
    for (const tab of ['Overview', 'Spend', 'Harness']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.locator('.an-card').first()).toBeVisible();
      const overflow = await page.evaluate(() => {
        const scroller = document.querySelector('.an')!;
        return scroller.scrollWidth - scroller.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});

test('is honest about an empty workspace', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openAnalytics(page);
  const main = page.getByRole('main', { name: 'Analytics' });
  await expect(main.getByText('No turns in this range yet.')).toBeVisible();
  await expect(main.getByRole('region', { name: 'Harness health' })).toContainText(
    'Not enough data yet',
  );
  await page.getByRole('radio', { name: 'Custom' }).click();
  await expect(page.getByLabel('From')).toBeVisible();
});
