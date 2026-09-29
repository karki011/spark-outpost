import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function openCalendar(page: Page) {
  await page.getByRole('radio', { name: /^Custom/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a custom date range' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function dayButton(dialog: Locator, day: number) {
  return dialog
    .locator('.rdp-month')
    .first()
    .locator('.rdp-day:not(.rdp-outside) .rdp-day_button')
    .filter({ hasText: new RegExp(`^${day}$`) });
}

async function showEarlierMonth(dialog: Locator) {
  const caption = dialog.locator('.rdp-caption_label');
  for (let step = 0; step < 2; step += 1) {
    const shown = (await caption.textContent()) ?? '';
    await dialog.getByRole('button', { name: /previous month/i }).click();
    await expect(caption).not.toHaveText(shown);
  }
}

async function blocking(page: Page, screen: string) {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .setLegacyMode(true)
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
      test.setTimeout(60_000);
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
      await openCalendar(page);
      found.push(...(await blocking(page, `${theme} calendar`)));
      expect(found).toEqual([]);
    });
  }

  test('picks a custom range with the calendar by mouse', async ({ page }) => {
    await openAnalytics(page);
    const dialog = await openCalendar(page);
    const apply = dialog.getByRole('button', { name: 'Apply' });
    await expect(apply).toBeDisabled();
    await showEarlierMonth(dialog);
    await dayButton(dialog, 5).click();
    await dayButton(dialog, 20).click();
    await expect(apply).toBeEnabled();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    const rangeButton = page.getByRole('radio', { name: /^Custom: .*–/ });
    await expect(rangeButton).toContainText('5');
    await expect(rangeButton).toContainText('20');
  });

  test('picks a custom range with the calendar by keyboard', async ({ page }) => {
    await openAnalytics(page);
    const dialog = await openCalendar(page);
    await showEarlierMonth(dialog);
    const start = dayButton(dialog, 5);
    await start.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    const rangeButton = page.getByRole('radio', { name: /^Custom: .*–/ });
    await expect(rangeButton).toContainText('5');
    await expect(rangeButton).toContainText('10');
  });

  test('applies a preset immediately and closes the popover', async ({ page }) => {
    await openAnalytics(page);
    const main = page.getByRole('main', { name: 'Analytics' });
    const dialog = await openCalendar(page);
    await dialog.getByRole('button', { name: 'Last 7 days' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('radio', { name: /^Custom: .*–/ })).toBeVisible();
    await expect(main.getByRole('region', { name: 'Activity' }).locator('.an-sum')).toContainText(
      'turn',
    );
  });

  test('disables future days in the calendar', async ({ page }) => {
    await openAnalytics(page);
    const dialog = await openCalendar(page);
    const future = dialog.locator('.rdp-month').last().locator('.rdp-day_button:disabled');
    await expect(future.first()).toBeVisible();
    await expect(future.first()).toBeDisabled();
  });

  test('Escape closes the calendar and returns focus to Custom', async ({ page }) => {
    await openAnalytics(page);
    await openCalendar(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Choose a custom date range' })).toBeHidden();
    await expect(page.getByRole('radio', { name: /^Custom/ })).toBeFocused();
  });

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

test('arrow keys move onto Custom without opening the calendar', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openAnalytics(page);
  const dialog = page.getByRole('dialog', { name: 'Choose a custom date range' });
  await page.getByRole('radio', { name: '90 days' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Custom' })).toBeFocused();
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
});

test('starts on 30 days and the calendar opens on those 30 days', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openAnalytics(page);
  await expect(page.getByRole('radio', { name: '30 days' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const dialog = await openCalendar(page);
  const selected = dialog.locator('.rdp-selected:not(.rdp-outside)');
  await expect(selected.first()).toBeVisible();
  const thisMonth = await selected.count();
  const caption = dialog.locator('.rdp-caption_label');
  const shownMonth = await caption.textContent();
  await dialog.getByRole('button', { name: /previous month/i }).click();
  await expect(caption).not.toHaveText(shownMonth ?? '');
  expect(thisMonth + (await selected.count())).toBe(30);
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
  await expect(page.getByRole('dialog', { name: 'Choose a custom date range' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('radio', { name: 'Custom' })).toBeFocused();
});

test('shows skeletons matching the layout on a cold load, then real data', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedAnalytics();
  await page.route('**/analytics/overview*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await openAnalytics(page);
  const main = page.getByRole('main', { name: 'Analytics' });
  const overviewPanel = main.locator('#an-panel');
  await expect(overviewPanel).toHaveAttribute('aria-busy', 'true');
  await expect(overviewPanel.locator('.an-skel-card').first()).toBeVisible();
  await expect(overviewPanel.getByText(/Loading .*…/)).toHaveCount(4);
  await expect(main.getByRole('region', { name: 'Harness health' })).toContainText('of 100', {
    timeout: 15_000,
  });
  await expect(overviewPanel).toHaveAttribute('aria-busy', 'false');
  await expect(overviewPanel.locator('.an-skel-card')).toHaveCount(0);
});
