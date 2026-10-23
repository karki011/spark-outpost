import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { seedChats } from './sidebar-seed.ts';

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
  await expect(page.locator('.cmp')).toHaveCount(0);
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

const DOCS = 'https://docs.example.com/';
const NEWS = 'https://news.example.com/';

async function pushView(page: Page, tabs: unknown[], favorites: unknown[] = []) {
  await page.evaluate(
    ([tabsArg, favoritesArg]) =>
      (
        window as unknown as {
          browserViewPush: (p: string, t: unknown[], f: unknown[]) => void;
        }
      ).browserViewPush('personal', tabsArg as unknown[], favoritesArg as unknown[]),
    [tabs, favorites],
  );
}

test('favorites and pinned tabs sit above Today', async ({ page }) => {
  const side = await openBrowserView(page);
  await pushView(
    page,
    [
      { title: 'Docs', url: DOCS, active: true, pinned: true, place: 'external' },
      { title: 'News', url: NEWS, place: 'external' },
    ],
    [{ id: 'f1', url: 'https://mail.example.com/', title: 'Mail' }],
  );
  const pinned = side.getByRole('list', { name: 'Pinned tabs' });
  await expect(pinned.getByRole('button', { name: 'Docs', exact: true })).toBeVisible();
  await expect(
    side.getByRole('list', { name: 'Tabs' }).getByRole('button', { name: 'News', exact: true }),
  ).toBeVisible();

  await pinned.getByRole('button', { name: 'Unpin Docs' }).click();
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({ profile: 'personal', command: { command: 'pin', tabId: 'v1', pinned: false } });

  const favorites = side.getByRole('list', { name: 'Favorites' });
  await favorites.getByRole('button', { name: 'Mail' }).click();
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({ profile: 'personal', command: { command: 'open_favorite', id: 'f1' } });

  await favorites.getByRole('button', { name: 'Add this page to Favorites' }).click();
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({ profile: 'personal', command: { command: 'add_favorite', tabId: 'v1' } });

  await pushView(
    page,
    [{ title: 'Docs', url: DOCS, active: true, place: 'external' }],
    [{ id: 'f2', url: DOCS, title: 'Docs' }],
  );
  await favorites.getByRole('button', { name: 'Remove this page from Favorites' }).click();
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({ profile: 'personal', command: { command: 'remove_favorite', id: 'f2' } });
});

test('Hand to chat gives a chat the page and opens that chat', async ({ page }) => {
  const [chatId] = await seedChats([{ title: 'Fix deploy docs' }]);
  await openBrowserView(page);
  await pushView(page, [{ title: 'Docs', url: DOCS, active: true, place: 'external' }]);
  const hand = page.getByRole('button', { name: 'Hand to chat' });
  await hand.click();
  const menu = page.getByRole('menu', { name: 'Hand this tab to a chat' });
  await expect(menu.getByRole('menuitem', { name: 'Fix deploy docs' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(hand).toBeFocused();

  await hand.click();
  await menu.getByRole('menuitem', { name: 'Fix deploy docs' }).click();
  await expect
    .poll(() => calls(page, 'view-hand'))
    .toEqual([{ profile: 'personal', tabId: 'v1', chatId }]);
  await expect(page.getByRole('region', { name: 'Browser' })).toBeVisible();
});

test('a chat’s page tab opens in the Browser view’s Work profile', async ({ page }) => {
  const [chatId] = await seedChats([{ title: 'Status check' }]);
  await withDesktopBrowser(page);
  await page.goto('/');
  await rail(page)
    .getByRole('button', { name: /^Chats/ })
    .click();
  await page
    .getByRole('button', { name: /Status check/ })
    .first()
    .click();
  await toggleHeaderPane(page, 'Browser');
  await page.evaluate(
    (id) =>
      (window as unknown as { browserPush: (c: string, t: unknown[]) => void }).browserPush(id, [
        { title: 'Status', url: 'https://status.example.com/', active: true, place: 'external' },
      ]),
    chatId!,
  );
  await page.getByRole('button', { name: 'Open in Browser view (Work)' }).click();
  await expect.poll(() => calls(page, 'view-from-chat')).toEqual([{ chatId, tabId: 't1' }]);
  await expect(
    page.getByRole('radiogroup', { name: 'Browser profile' }).getByRole('radio', { name: 'Work' }),
  ).toBeChecked();
});
