import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';

interface Sent {
  chatId: string;
  command: Record<string, unknown>;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

async function openPane(page: Page): Promise<{ pane: Locator; chatId: string }> {
  await withDesktopBrowser(page);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await toggleHeaderPane(page, 'Browser');
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeVisible();
  const started = (await calls(page, 'start')) as { chatId: string }[];
  const chatId = started[0]!.chatId;
  await page.evaluate((chat) => {
    (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
      chat,
      [
        { title: 'One', url: 'http://localhost:5173/', active: true },
        { title: 'Two', url: 'http://localhost:5173/two' },
        { title: 'Three', url: 'https://example.com/', owner: 'agent' },
      ],
    );
  }, chatId);
  await expect(pane.getByRole('tab', { name: 'One', exact: true })).toBeVisible();
  return { pane, chatId };
}

async function sentSince(page: Page, before: number): Promise<Record<string, unknown>[]> {
  const sent = (await calls(page, 'command')) as Sent[];
  return sent.slice(before).map((call) => call.command);
}

async function sentCount(page: Page): Promise<number> {
  return ((await calls(page, 'command')) as Sent[]).length;
}

async function press(page: Page, keys: string): Promise<Record<string, unknown>[]> {
  const before = await sentCount(page);
  await page.keyboard.press(keys);
  return sentSince(page, before);
}

test('pane shortcuts run from the address bar and stay inside the pane', async ({ page }) => {
  const { pane } = await openPane(page);
  const address = pane.getByLabel('Address');
  await address.focus();

  expect(await press(page, 'ControlOrMeta+R')).toEqual([{ command: 'reload', tabId: 't1' }]);
  expect(await press(page, 'ControlOrMeta+Shift+R')).toEqual([
    { command: 'hard_reload', tabId: 't1' },
  ]);
  expect(await press(page, 'ControlOrMeta+BracketLeft')).toEqual([
    { command: 'back', tabId: 't1' },
  ]);
  expect(await press(page, 'ControlOrMeta+BracketRight')).toEqual([
    { command: 'forward', tabId: 't1' },
  ]);
  expect(await press(page, 'ControlOrMeta+2')).toEqual([{ command: 'select', tabId: 't2' }]);
  expect(await press(page, 'ControlOrMeta+9')).toEqual([{ command: 'select', tabId: 't3' }]);
  expect(await press(page, 'ControlOrMeta+5')).toEqual([]);
  expect(await press(page, 'Control+Tab')).toEqual([{ command: 'select', tabId: 't2' }]);
  expect(await press(page, 'Control+Shift+Tab')).toEqual([{ command: 'select', tabId: 't3' }]);
  expect(await press(page, 'ControlOrMeta+T')).toEqual([{ command: 'new_tab', url: null }]);
  expect(await press(page, 'ControlOrMeta+W')).toEqual([{ command: 'close', tabId: 't1' }]);
  expect(await press(page, 'ControlOrMeta+Shift+T')).toEqual([{ command: 'reopen' }]);

  expect(await press(page, 'ControlOrMeta+Shift+C')).toEqual([
    { command: 'copy_url', tabId: 't1' },
  ]);
  await expect(pane.getByRole('status').filter({ hasText: 'Copied URL' })).toBeVisible();
  await expect(pane.getByText('Copied URL')).toBeHidden({ timeout: 4000 });

  await pane.getByRole('button', { name: 'Reload' }).focus();
  await press(page, 'ControlOrMeta+L');
  await expect(address).toBeFocused();
  expect(await address.evaluate((input: HTMLInputElement) => input.selectionEnd)).toBe(
    'http://localhost:5173/'.length,
  );

  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.focus();
  expect(await press(page, 'ControlOrMeta+R')).toEqual([]);
  expect(await press(page, 'ControlOrMeta+2')).toEqual([]);
});

test('editing keys and composing keys are left alone in the address bar', async ({ page }) => {
  const { pane } = await openPane(page);
  const address = pane.getByLabel('Address');
  await address.focus();
  expect(await press(page, 'ControlOrMeta+A')).toEqual([]);
  expect(await press(page, 'ControlOrMeta+C')).toEqual([]);

  const before = await sentCount(page);
  await address.evaluate((input) => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 't',
        code: 'KeyT',
        metaKey: navigator.platform.startsWith('Mac'),
        ctrlKey: !navigator.platform.startsWith('Mac'),
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  expect(await sentSince(page, before)).toEqual([]);
});

test('a shortcut pressed in the page reaches the pane of its chat only', async ({ page }) => {
  const { pane, chatId } = await openPane(page);
  const push = (chat: string, shortcut: string) =>
    page.evaluate(
      ({ chat, shortcut }) =>
        (window as unknown as { browserShortcut: (event: unknown) => void }).browserShortcut({
          chatId: chat,
          shortcut,
        }),
      { chat, shortcut },
    );

  let before = await sentCount(page);
  await push(chatId, 'tab_2');
  expect(await sentSince(page, before)).toEqual([{ command: 'select', tabId: 't2' }]);

  before = await sentCount(page);
  await push('99999999-2222-4333-8444-555555555555', 'reload');
  await push(chatId, 'no_such_shortcut');
  expect(await sentSince(page, before)).toEqual([]);

  await push(chatId, 'focus_address');
  await expect(pane.getByLabel('Address')).toBeFocused();
});

test('find in page opens, searches, steps and closes', async ({ page }) => {
  const { pane, chatId } = await openPane(page);
  await pane.getByLabel('Address').focus();
  await press(page, 'ControlOrMeta+F');
  const find = pane.getByRole('searchbox', { name: 'Find in page' });
  await expect(find).toBeFocused();

  let before = await sentCount(page);
  await find.pressSequentially('ex');
  expect((await sentSince(page, before)).at(-1)).toEqual({
    command: 'find',
    tabId: 't1',
    text: 'ex',
    forward: true,
    next: false,
  });
  await page.evaluate(
    (chat) =>
      (window as unknown as { browserFound: (found: unknown) => void }).browserFound({
        chatId: chat,
        tabId: 't1',
        active: 2,
        matches: 5,
      }),
    chatId,
  );
  await expect(pane.getByText('2 of 5')).toBeVisible();

  expect(await press(page, 'Enter')).toEqual([
    { command: 'find', tabId: 't1', text: 'ex', forward: true, next: true },
  ]);
  expect(await press(page, 'Shift+Enter')).toEqual([
    { command: 'find', tabId: 't1', text: 'ex', forward: false, next: true },
  ]);

  await pane.getByLabel('Address').focus();
  await press(page, 'ControlOrMeta+F');
  await expect(find).toBeFocused();
  await expect(find).toHaveValue('ex');

  before = await sentCount(page);
  await page.keyboard.press('Escape');
  await expect(find).toBeHidden();
  expect(await sentSince(page, before)).toEqual(
    expect.arrayContaining([
      { command: 'stop_find', tabId: 't1' },
      { command: 'focus', tabId: 't1' },
    ]),
  );
});
