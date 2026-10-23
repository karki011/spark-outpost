import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBrowserView, pushView, viewCommands } from './browser-view-support.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const DOCS = 'https://docs.example.com/deploying';

async function visit(page: Page, profile: string, url: string, title: string) {
  const status = await page.evaluate(
    async (event) =>
      (
        await fetch('/api/browser-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
      ).status,
    { kind: 'visit', profile, url, title },
  );
  expect(status).toBe(204);
}

async function shortcut(page: Page, name: string) {
  await page.evaluate(
    (sent) =>
      (window as unknown as { browserViewShortcut: (e: unknown) => void }).browserViewShortcut({
        profile: 'personal',
        shortcut: sent,
      }),
    name,
  );
}

async function openWithPages(page: Page) {
  await openBrowserView(page);
  await pushView(page, [
    { title: 'Deploying your app', url: DOCS, active: true, place: 'external' },
    { title: 'Weather', url: 'https://weather.example.com/', place: 'external' },
  ]);
  await visit(page, 'personal', 'https://docs.example.com/previews', 'Deploy previews');
  await visit(page, 'work', 'https://work.example.com/previews', 'Work previews');
}

const bar = (page: Page, name: string) => page.getByRole('dialog', { name });

test('⌘T finds history from this profile only and opens it in a new tab', async ({ page }) => {
  await openWithPages(page);
  await shortcut(page, 'new_tab');
  const dialog = bar(page, 'Open a new tab');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('previews');
  const options = dialog.getByRole('option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText('Deploy previews');
  await expect(dialog).not.toContainText('Work previews');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({
      profile: 'personal',
      command: { command: 'new_tab', url: 'https://docs.example.com/previews' },
    });
});

test('⌘L starts from this address, switches to an open tab, and goes to a typed one', async ({
  page,
}) => {
  await openWithPages(page);
  await shortcut(page, 'focus_address');
  const dialog = bar(page, 'Go to');
  await expect(dialog.getByRole('combobox')).toHaveValue(DOCS);
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('weather');
  await expect(dialog.getByRole('option', { name: /Weather/ })).toContainText('Switch');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({ profile: 'personal', command: { command: 'select', tabId: 'v2' } });

  await shortcut(page, 'focus_address');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('example.org/notes');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({
      profile: 'personal',
      command: { command: 'navigate', tabId: 'v1', url: 'https://example.org/notes' },
    });

  await shortcut(page, 'focus_address');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('example.org/later');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({
      profile: 'personal',
      command: { command: 'new_tab', url: 'https://example.org/later' },
    });
});

test('an action runs from the bar, and Esc gives focus back', async ({ page }) => {
  await openWithPages(page);
  const address = page.getByRole('navigation', { name: 'Browser' }).getByLabel('Address');
  await address.focus();
  await page.keyboard.press('ControlOrMeta+t');
  await expect(bar(page, 'Open a new tab')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(address).toBeFocused();

  await page.keyboard.press('ControlOrMeta+l');
  await page.keyboard.type('ask spark');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Ask Spark' })).toBeVisible();
});

test('the command bar passes an accessibility check', async ({ page }) => {
  await openWithPages(page);
  await shortcut(page, 'new_tab');
  await expect(bar(page, 'Open a new tab').getByRole('option').first()).toBeVisible();
  await animationsSettled(page);
  const results = await new AxeBuilder({ page }).include('.sp-panel').analyze();
  expect(results.violations).toEqual([]);
});

test('Settings clears history by range and profile', async ({ page }) => {
  await openWithPages(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Browser pane' }).click();
  const history = page
    .getByRole('dialog', { name: 'Browser pane' })
    .getByRole('group', { name: 'Clear browser history' });
  await history.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('menuitemradio', { name: 'Work', exact: true }).click();
  await history.getByRole('button', { name: 'Clear browser history' }).click();
  await expect(history.getByRole('status')).toHaveText('Cleared 1 page.');
  await page.keyboard.press('Escape');

  await shortcut(page, 'new_tab');
  await page.keyboard.type('previews');
  await expect(bar(page, 'Open a new tab').getByRole('option')).toHaveCount(1);
});
