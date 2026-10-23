import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function openBrowserView(page: Page) {
  await withDesktopBrowser(page);
  await page.goto('/');
  await rail(page).getByRole('button', { name: 'Browser' }).click();
  const side = page.getByRole('navigation', { name: 'Browser' });
  await expect(side).toBeVisible();
  return side;
}

async function viewCommands(page: Page) {
  return (await calls(page, 'view-command')) as { profile: string; command: unknown }[];
}

test('the web app and paired devices have no Browser view', async ({ page }) => {
  await page.goto('/');
  await expect(rail(page).getByRole('button', { name: 'Chats' })).toBeVisible();
  await expect(rail(page).getByRole('button', { name: 'Browser' })).toHaveCount(0);
});

test('the Browser view opens in Personal, which agents cannot reach', async ({ page }) => {
  const side = await openBrowserView(page);
  const profiles = side.getByRole('radiogroup', { name: 'Browser profile' });
  await expect(profiles.getByRole('radio', { name: 'Personal' })).toBeChecked();
  await expect(side.getByText('Agents can’t open or read these tabs')).toBeVisible();
  const started = async () => [...new Set(await calls(page, 'view-start'))];
  await expect.poll(started).toEqual(['personal']);
  await expect
    .poll(async () => ((await calls(page, 'view-place')) as { profile: string }[]).at(-1))
    .toMatchObject({ profile: 'personal', covered: false });
  const page_ = page.getByRole('main', { name: 'New tab' });
  await expect(page_.getByText('Personal', { exact: true })).toBeVisible();

  await profiles.getByRole('radio', { name: 'Personal' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(profiles.getByRole('radio', { name: 'Work' })).toBeChecked();
  await expect(profiles.getByRole('radio', { name: 'Work' })).toBeFocused();
  await expect(side.getByText('Shared with every chat’s agent')).toBeVisible();
  await expect.poll(started).toEqual(['personal', 'work']);

  await page.reload();
  await expect(
    page.getByRole('radiogroup', { name: 'Browser profile' }).getByRole('radio', { name: 'Work' }),
  ).toBeChecked();
});

test('the address bar and tab list drive the chosen profile’s tabs', async ({ page }) => {
  const side = await openBrowserView(page);
  const address = side.getByRole('textbox', { name: 'Address' });
  await expect(address).toBeFocused();
  await address.fill('example.com');
  await address.press('Enter');
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({
      profile: 'personal',
      command: { command: 'navigate', tabId: 'v1', url: 'example.com' },
    });

  await page.evaluate(() =>
    (window as unknown as { browserViewPush: (p: string, t: unknown[]) => void }).browserViewPush(
      'personal',
      [
        { title: 'Example Domain', url: 'https://example.com/', active: true, place: 'external' },
        { title: 'Docs', url: 'https://docs.example.com/', place: 'external' },
      ],
    ),
  );
  const tabs = side.getByRole('list', { name: 'Tabs' });
  const tab = (name: string) => tabs.getByRole('button', { name, exact: true });
  await expect(tabs.getByRole('listitem')).toHaveCount(2);
  await expect(tab('Example Domain')).toHaveAttribute('aria-current', 'page');
  await expect(tab('Docs')).not.toHaveAttribute('aria-current');
  await expect(page.getByRole('main', { name: 'Example Domain' })).toContainText('example.com');

  await tab('Example Domain').focus();
  await page.keyboard.press('ArrowDown');
  await expect(tab('Docs')).toBeFocused();
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({ profile: 'personal', command: { command: 'select', tabId: 'v2' } });

  await side.getByRole('button', { name: 'Close Docs' }).click();
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({ profile: 'personal', command: { command: 'close', tabId: 'v2' } });

  await side.getByRole('button', { name: /New tab/ }).click();
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({ profile: 'personal', command: { command: 'new_tab', url: null } });
});

test('page keys reach the profile that owns the focused page', async ({ page }) => {
  await openBrowserView(page);
  await page.evaluate(() => {
    const push = (window as unknown as { browserViewShortcut: (event: unknown) => void })
      .browserViewShortcut;
    push({ profile: 'work', shortcut: 'new_tab' });
    push({ profile: 'personal', shortcut: 'new_tab' });
  });
  await expect
    .poll(() => viewCommands(page))
    .toEqual([{ profile: 'personal', command: { command: 'new_tab', url: null } }]);
});

test('the Browser view passes an accessibility check', async ({ page }) => {
  await openBrowserView(page);
  const results = await new AxeBuilder({ page }).include('.bv').analyze();
  expect(results.violations).toEqual([]);
});
