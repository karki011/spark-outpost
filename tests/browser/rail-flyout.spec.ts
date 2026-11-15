import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const more = (page: Page) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^More/ });
const menu = (page: Page) => page.getByRole('menu', { name: 'More' });

test('More holds pause, places and settings, each on one line', async ({ page }) => {
  await openChats(page);
  const rail = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Analytics', 'Docs', 'Remote control', 'Settings', 'Pause Spark']) {
    await expect(rail.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await more(page).click();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
  const items = menu(page).getByRole('menuitem');
  await expect(items).toHaveText([
    'Pause Spark',
    /^Analytics/,
    /^Docs/,
    /^Remote control/,
    /^Settings…/,
    'What’s new',
    'Send feedback',
  ]);
  for (const item of await items.all()) {
    const box = (await item.boundingBox())!;
    expect(box.height).toBeLessThan(40);
    const label = item.locator('.rail-flyout-label');
    expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(more(page)).toBeFocused();
});

test('places open from More and the rail marks More while one shows', async ({ page }) => {
  await openChats(page);
  await more(page).click();
  await menu(page).getByRole('menuitem', { name: /^Docs/ }).click();
  await expect(page.getByRole('main', { name: 'Docs' })).toBeVisible();
  await expect(more(page)).toHaveAccessibleName('More, showing Docs');
  await more(page).click();
  await expect(menu(page).getByRole('menuitem', { name: /^Docs/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await menu(page)
    .getByRole('menuitem', { name: /^Settings…/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'General' })).toBeVisible();
});

test('pausing from More shows a dot on More until Spark resumes', async ({ page }) => {
  await openChats(page);
  await more(page).click();
  await menu(page).getByRole('menuitem', { name: 'Pause Spark' }).click();
  await expect(more(page)).toHaveAccessibleName('More, Spark is paused');
  await expect(more(page).locator('.rdot')).toBeVisible();
  await more(page).click();
  await menu(page).getByRole('menuitem', { name: 'Resume Spark' }).click();
  await expect(more(page)).toHaveAccessibleName('More');
  await expect(more(page).locator('.rdot')).toHaveCount(0);
});
