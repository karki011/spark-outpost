import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  expectInsideViewport,
  expectNoSidewaysScroll,
  openSettings,
  openTouch,
  PHONE,
  smallTextInputs,
} from './responsive-kit.ts';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function openSettingsDialog(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Profile & personality' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const search = (page: Page) => page.getByRole('combobox', { name: 'Search settings' });
const results = (page: Page) => page.getByRole('listbox', { name: 'Matching settings' });
const sections = (page: Page) => page.getByRole('tablist', { name: 'Settings sections' });

async function noViolations(page: Page, theme: string, screen: string) {
  await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
  await page.evaluate(() => document.fonts.ready);
  const found = await new AxeBuilder({ page }).include('.set-nav').withTags(WCAG_TAGS).analyze();
  expect(
    found.violations.map((violation) => `${theme} ${screen}: ${violation.id}`),
    screen,
  ).toEqual([]);
}

test('the sections sit under six groups, each tab described by its group', async ({ page }) => {
  await openSettingsDialog(page);
  await expect(page.locator('.set-nav-group')).toHaveText([
    'General',
    'Agents',
    'Work',
    'Connections',
    'Mac',
    'App',
  ]);
  await expect(sections(page).getByRole('tab')).toHaveText([
    'Profile & personality',
    'Spark assistant',
    'Appearance',
    /^AI providers/,
    'Models',
    'Crew',
    'Usage',
    'Projects',
    'Chats & autonomy',
    'Pull requests',
    'Connectors',
    'MCP servers',
    'Notifications',
    'Help',
    'Reset',
  ]);
  const notifications = sections(page).getByRole('tab', { name: 'Notifications' });
  await expect(notifications).toHaveAccessibleDescription('Mac');
  await notifications.click();
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog.getByRole('switch', { name: 'Morning brief' })).toBeVisible();
  await expect(dialog.getByRole('radiogroup', { name: 'Status companion' })).toBeVisible();
  await sections(page).getByRole('tab', { name: 'Pull requests' }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Pull requests' })
      .getByRole('switch', { name: 'Follow up on pull requests' }),
  ).toBeVisible();
});

test('search finds Morning brief and opens Notifications focused on it', async ({ page }) => {
  await openSettingsDialog(page);
  await search(page).fill('Morning brief');
  await expect(sections(page)).toHaveCount(0);
  const option = results(page).getByRole('option', { name: /^Morning brief/ });
  await expect(option).toContainText('Mac · Notifications');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(search(page)).toHaveAttribute('aria-activedescendant', /.+/);
  await search(page).press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  const brief = dialog.getByRole('switch', { name: 'Morning brief' });
  await expect(brief).toBeFocused();
  await expect(dialog.locator('.set-row[data-found]')).toContainText('Morning brief');
  await expect(search(page)).toHaveValue('');
  await expect(sections(page).getByRole('tab', { name: 'Notifications' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Tab');
  await expect(dialog.locator('[data-found]')).toHaveCount(0);
});

test('search finds a Spark assistant row under General', async ({ page }) => {
  await openSettingsDialog(page);
  await search(page).fill('key facts');
  const option = results(page).getByRole('option', { name: /^Key facts/ });
  await expect(option).toContainText('General · Spark assistant');
  await search(page).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Spark assistant' });
  await expect(dialog.locator('.set-row[data-found]')).toContainText('Key facts');
});

test('the search works from the keyboard', async ({ page }) => {
  await openSettingsDialog(page);
  await search(page).focus();
  await page.keyboard.type('compact');
  const options = results(page).getByRole('option');
  await expect(options).toHaveText([/^Compact automatically at/]);
  await search(page).fill('pull');
  await expect(options.first()).toHaveText(/^Pull requests\s*Work$/);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  const count = await options.count();
  expect(count).toBeGreaterThan(1);
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(options.first()).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(options.last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Pull requests' })).toBeVisible();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue('');

  await page.keyboard.type('zzzz');
  await expect(page.getByRole('status').filter({ hasText: 'No settings match' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search(page)).toHaveValue('');
  await expect(sections(page)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Pull requests' })).toBeVisible();

  await page.keyboard.type('wait before');
  await page.keyboard.press('Enter');
  const chats = page.getByRole('dialog', { name: 'Chats & autonomy' });
  const wait = chats.getByRole('radiogroup', { name: 'Wait before going on without your answer' });
  await expect(wait.getByRole('radio', { name: '60s' })).toBeFocused();

  await search(page).focus();
  await page.keyboard.press('Escape');
  await expect(chats).toHaveCount(0);
});

test('search works at phone width', async ({ browser }) => {
  const page = await openTouch(browser, PHONE, 'home');
  await openSettings(page, true);
  await expect(sections(page)).toBeVisible();
  await expectInsideViewport(page, search(page));
  expect(await smallTextInputs(page)).toEqual([]);
  await search(page).fill('brief');
  const option = results(page).getByRole('option', { name: /^Morning brief/ });
  await expectInsideViewport(page, option);
  await option.tap();
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog.getByRole('switch', { name: 'Morning brief' })).toBeFocused();
  await expectInsideViewport(page, dialog.getByRole('switch', { name: 'Morning brief' }));
  await expect(sections(page)).toBeVisible();
  const strip = await sections(page).boundingBox();
  expect(strip!.height).toBeLessThan(80);
  await expectNoSidewaysScroll(page);
  await page.close();
});

for (const theme of ['light', 'graphite']) {
  test(`the grouped sidebar and its search pass axe in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSettingsDialog(page);
    await noViolations(page, theme, 'groups');
    await search(page).fill('pull');
    await expect(results(page)).toBeVisible();
    await noViolations(page, theme, 'search results');
    await search(page).fill('zzzz');
    await noViolations(page, theme, 'no results');
  });
}
