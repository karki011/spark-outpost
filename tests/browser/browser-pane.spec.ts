import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { openChats } from './navigation.ts';
import {
  chatMenuButton,
  chatMenuDot,
  expectHeaderPane,
  headerPaneItem,
  openChatMenu,
  toggleHeaderPane,
} from './header-menu.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openPane(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await toggleHeaderPane(page, 'Browser');
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeVisible();
  return pane;
}

async function chatId(page: Page): Promise<string> {
  const started = (await calls(page, 'start')) as { chatId: string }[];
  return started[0]!.chatId;
}

test('the web app has no Browser item in the chat menu', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const menu = await openChatMenu(page);
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText([/^Terminal/]);
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await expect(
    page.locator('.head-r').getByRole('button', { name: /Browser|Terminal|Agent TV/ }),
  ).toHaveCount(0);
});

test('the Mac app lists Browser and Terminal in the chat menu with their shortcuts', async ({
  page,
}) => {
  await withDesktopBrowser(page);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await chatMenuButton(page).focus();
  await page.keyboard.press('ArrowDown');
  const browser = headerPaneItem(page, 'Browser');
  await expect(browser).toBeFocused();
  await expect(browser).toHaveAttribute('aria-checked', 'false');
  await expect(browser).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+Shift\+B$/);
  await expect(headerPaneItem(page, 'Terminal')).toHaveAttribute('aria-checked', 'false');
  await expect(chatMenuDot(page)).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(headerPaneItem(page, 'Terminal')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('.head-r').getByRole('menu')).toHaveCount(0);
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane.getByLabel('Address')).toBeFocused();
  await expectHeaderPane(page, 'Browser', true);

  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(pane).toBeHidden();
  await expectHeaderPane(page, 'Browser', false);
  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(pane).toBeVisible();
  await pane.getByRole('button', { name: 'Hide work panel' }).click();
  await expect(pane).toBeHidden();
  await expectHeaderPane(page, 'Browser', false);
});

test('the Mac app opens the Browser pane and tells the shell where it is', async ({ page }) => {
  await withDesktopBrowser(page);
  const pane = await openPane(page);
  await expect(pane.getByText('Type an address above to open a page.')).toBeVisible();
  await expect(pane.getByLabel('Address')).toBeFocused();

  await expect
    .poll(async () => {
      const last = (
        (await calls(page, 'place')) as { bounds: { x: number; width: number } | null }[]
      ).at(-1);
      const box = await page.locator('#bp-view').boundingBox();
      return last?.bounds && box
        ? [last.bounds.x - Math.round(box.x), last.bounds.width - Math.round(box.width)]
        : null;
    })
    .toEqual([0, 0]);
  await expect
    .poll(async () => (await calls(page, 'place')).at(-1))
    .toMatchObject({ covered: false, projectId: null });
  await expect(page.locator('#work-panel .wp-in')).toHaveCSS('opacity', '1');

  const axe = await new AxeBuilder({ page }).include('#work-panel').analyze();
  expect(axe.violations).toEqual([]);

  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(pane).toBeHidden();
  await expect
    .poll(async () => ((await calls(page, 'place')) as { bounds: unknown }[]).at(-1)?.bounds)
    .toBeNull();
});

test('the address bar, tabs and badges drive the shell', async ({ page }) => {
  await withDesktopBrowser(page);
  const pane = await openPane(page);
  const id = await chatId(page);
  const address = pane.getByLabel('Address');

  await address.fill('how do I center a div');
  await address.press('Enter');
  await expect(pane.getByRole('alert')).toContainText('Type a web address');
  await address.fill('localhost:5173');
  await address.press('Enter');
  expect((await calls(page, 'command')).at(-1)).toEqual({
    chatId: id,
    command: { command: 'navigate', tabId: 't1', url: 'localhost:5173' },
  });

  await page.evaluate((chat) => {
    (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
      chat,
      [
        { title: 'My app', url: 'http://localhost:5173/', active: true, canGoBack: true },
        { title: 'Docs', url: 'http://localhost:5173/docs', owner: 'agent', driving: true },
      ],
    );
  }, id);
  await expect(pane.getByRole('tab', { name: 'My app', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(pane.getByRole('tab', { name: 'Agent Docs' })).toHaveAttribute('tabindex', '-1');
  await expect(pane.getByRole('tablist', { name: 'Browser tabs' })).toBeAttached();
  await expect(pane.locator('.bp-tabs [role="tab"]')).toHaveCount(2);
  await expect(address).toHaveValue('http://localhost:5173/');
  await expect(pane.getByRole('button', { name: 'Back' })).toBeEnabled();
  await expect(pane.getByRole('button', { name: 'Forward' })).toBeDisabled();

  await pane.getByRole('tab', { name: 'My app', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  expect((await calls(page, 'command')).at(-1)).toEqual({
    chatId: id,
    command: { command: 'select', tabId: 't2' },
  });
  await pane.getByRole('button', { name: 'Keep Docs open' }).click();
  expect((await calls(page, 'command')).at(-1)).toEqual({
    chatId: id,
    command: { command: 'pin', tabId: 't2', pinned: true },
  });
  await pane.getByRole('button', { name: 'Select an element for the chat' }).click();
  expect((await calls(page, 'command')).at(-1)).toEqual({
    chatId: id,
    command: { command: 'pick', tabId: 't1', mode: 'element' },
  });

  await page.evaluate((chat) => {
    (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
      chat,
      [
        {
          title: 'Docs',
          url: 'http://localhost:5173/docs',
          owner: 'agent',
          active: true,
          driving: true,
        },
      ],
    );
  }, id);
  await expect(pane.getByText('Spark is driving')).toBeVisible();
  await expect(pane.getByRole('group', { name: 'Agent tab' })).toBeVisible();
});

test('a dialog over the pane swaps the page for its snapshot', async ({ page }) => {
  await withDesktopBrowser(page);
  const pane = await openPane(page);
  const id = await chatId(page);
  await page.evaluate((chat) => {
    (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
      chat,
      [{ title: 'My app', url: 'http://localhost:5173/', active: true }],
    );
  }, id);
  await expect(pane.getByRole('tab', { name: 'My app', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Settings/ })
    .click();
  await expect(page.locator('[aria-modal="true"]')).toBeVisible();
  await expect
    .poll(async () => ((await calls(page, 'place')) as { covered: boolean }[]).at(-1)?.covered)
    .toBe(true);
  await page.evaluate((chat) => {
    (window as unknown as { browserSnapshot: (id: string, image: string) => void }).browserSnapshot(
      chat,
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    );
  }, id);
  await expect(page.locator('.bp-snapshot')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => ((await calls(page, 'place')) as { covered: boolean }[]).at(-1)?.covered)
    .toBe(false);
});

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function selectBuyButton(page: Page, chat: string) {
  await page.evaluate(
    ({ chat, image }) => {
      (window as unknown as { browserPick: (pick: unknown) => void }).browserPick({
        chatId: chat,
        kind: 'element',
        url: 'http://localhost:5173/cart',
        title: 'Cart',
        box: { x: 1, y: 2, width: 30, height: 10 },
        elements: [
          {
            role: 'button',
            name: 'Buy',
            html: '<button>Buy</button>',
            styles: { color: 'rgb(0, 0, 0)' },
            box: { x: 1, y: 2, width: 30, height: 10 },
          },
        ],
        image,
      });
    },
    { chat, image: PIXEL },
  );
}

test('a selected element is one chip that shows what the agent gets @packaged', async ({
  page,
}) => {
  await withDesktopBrowser(page);
  await openPane(page);
  const id = await chatId(page);
  await selectBuyButton(page, id);
  const draft = page.locator('.chips');
  const chip = draft.getByRole('button', { name: 'Selected: Buy button', exact: true });
  await expect(chip).toBeVisible();
  await expect(draft.locator('.chip-slot')).toHaveCount(1);
  await expect(page.getByText('selected-button-buy.txt')).toHaveCount(0);

  await chip.click();
  const detail = draft.getByRole('group', { name: 'What the agent gets: Selected: Buy button' });
  await expect(detail).toContainText('marked as untrusted page data');
  await expect(detail.locator('pre')).toContainText('Role: button "Buy"');
  await expect(detail.locator('pre')).toContainText('<page_evidence>');
  await expect(detail.getByRole('img', { name: 'Picture of Selected: Buy button' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('.chips').analyze();
  expect(axe.violations).toEqual([]);
  await chip.press('Escape');
  await expect(detail).toHaveCount(0);

  await draft.getByRole('button', { name: 'Remove Selected: Buy button' }).click();
  await expect(draft.locator('.chip-slot')).toHaveCount(0);

  await selectBuyButton(page, id);
  await expect(chip).toBeVisible();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/messages') && response.request().method() === 'POST',
  );
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Make this wider');
  await input.press('Enter');
  const sent = (await (await saved).request().postDataJSON()) as { attachmentIds?: string[] };
  expect(sent.attachmentIds).toHaveLength(2);

  const message = page.locator('.msg-atts').first();
  const sentChip = message.getByRole('button', { name: 'Selected: Buy button', exact: true });
  await expect(sentChip).toBeVisible();
  await expect(message.getByText('selected-button-buy.txt')).toHaveCount(0);
  await expect(message.locator('.msg-att-img')).toHaveCount(0);
  await sentChip.click();
  await expect(message.locator('pre')).toContainText('Role: button "Buy"');
});

test('the header is one row of tabs with New tab next to them', async ({ page }) => {
  await withDesktopBrowser(page);
  const pane = await openPane(page);
  const id = await chatId(page);
  const push = (tabs: unknown[]) =>
    page.evaluate(
      ({ chat, tabs }) =>
        (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
          chat,
          tabs,
        ),
      { chat: id, tabs },
    );
  const placed = async () => {
    const last = ((await calls(page, 'place')) as { bounds: Box | null }[]).at(-1);
    const box = await page.locator('#bp-view').boundingBox();
    if (!last?.bounds || !box) return null;
    return [
      last.bounds.x - Math.round(box.x),
      last.bounds.y - Math.round(box.y),
      last.bounds.width - Math.round(box.width),
      last.bounds.height - Math.round(box.height),
    ];
  };

  await push([{ title: 'My app', url: 'http://localhost:5173/', active: true }]);
  const tab = pane.getByRole('tab', { name: 'My app', exact: true });
  const add = pane.getByRole('button', { name: 'New tab' });
  const close = pane.getByRole('button', { name: 'Hide work panel' });
  await expect(tab).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Panel' })).toHaveCount(0);
  await expect(pane.locator('.bp-title')).toHaveCount(0);
  const boxOf = async (locator: Locator) => (await locator.boundingBox())!;
  const tabBox = await boxOf(tab);
  const addBox = await boxOf(add);
  const closeBox = await boxOf(close);
  const addressBox = await boxOf(pane.getByLabel('Address'));
  const viewBox = await boxOf(page.locator('#bp-view'));
  const middle = (box: Box) => box.y + box.height / 2;
  expect(Math.abs(middle(tabBox) - middle(addBox))).toBeLessThan(3);
  expect(Math.abs(middle(tabBox) - middle(closeBox))).toBeLessThan(3);
  expect(addBox.x - (tabBox.x + tabBox.width)).toBeLessThan(40);
  expect(closeBox.x).toBeGreaterThan(addBox.x + 100);
  expect(addressBox.y).toBeGreaterThan(tabBox.y + tabBox.height);
  expect(viewBox.y - (addressBox.y + addressBox.height)).toBeLessThan(16);
  await expect.poll(placed).toEqual([0, 0, 0, 0]);

  await push(
    Array.from({ length: 12 }, (_, index) => ({
      title: `A page with a long title number ${index + 1}`,
      url: `http://localhost:5173/${index + 1}`,
      active: index === 11,
    })),
  );
  const last = pane.getByRole('tab', { name: /number 12$/ });
  await expect(last).toBeInViewport();
  await expect(pane.getByRole('tab', { name: /number 1$/ })).not.toBeInViewport();
  await expect(add).toBeInViewport();
  await expect(close).toBeInViewport();
  await expect(pane.getByRole('button', { name: /^Close A page .* number 12$/ })).toBeInViewport();
  expect(
    await pane.locator('.bp-tabs').evaluate((strip) => strip.scrollWidth > strip.clientWidth),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await last.focus();
  await page.keyboard.press('Home');
  expect((await calls(page, 'command')).at(-1)).toEqual({
    chatId: id,
    command: { command: 'select', tabId: 't1' },
  });
  await expect.poll(placed).toEqual([0, 0, 0, 0]);

  await push([
    { title: 'My app', url: 'http://localhost:5173/', active: true, picking: true, loading: true },
  ]);
  await expect(pane.getByRole('status').filter({ hasText: 'Esc cancels' })).toBeVisible();
  await expect(pane.getByLabel('Address')).toHaveCount(0);
  await expect(pane.getByRole('status').filter({ hasText: 'Page is opening' })).toBeAttached();
  await expect.poll(placed).toEqual([0, 0, 0, 0]);
  const axe = await new AxeBuilder({ page }).include('#work-panel').analyze();
  expect(axe.violations).toEqual([]);
});

test('a chat starts with the pane closed and each chat remembers its own', async ({ page }) => {
  await withDesktopBrowser(page);
  const pane = await openPane(page);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('First chat');
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });
  await expect(pane).toBeVisible();

  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await expect(pane).toBeHidden();
  await expectHeaderPane(page, 'Browser', false);

  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('First chat').click();
  await expect(pane).toBeVisible();
});

test('closing the pane keeps it closed when the chat gets work', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await withDesktopBrowser(page);
  const pane = await openPane(page);
  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(pane).toBeHidden();

  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.todo-line')).toContainText('3 of 3 done', { timeout: 20_000 });
  await expect(pane).toBeHidden();
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await expect(panel.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');

  await panel.getByRole('tab', { name: 'Browser' }).click();
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('tab', { name: 'Browser', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const tabs = pane.locator('.bp-tabs [role="tab"]').first();
  const switchBox = await pane.getByRole('tablist', { name: 'Panel' }).boundingBox();
  const tabBox = (await tabs.boundingBox())!;
  expect(
    Math.abs(switchBox!.y + switchBox!.height / 2 - (tabBox.y + tabBox.height / 2)),
  ).toBeLessThan(3);
  const axe = await new AxeBuilder({ page }).include('#work-panel').analyze();
  expect(axe.violations).toEqual([]);

  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(pane).toBeHidden();
  await expect(panel.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
});

test('the pane opens with a notice when the agent opens a page', async ({ page }) => {
  await withDesktopBrowser(page);
  const pane = await openPane(page);
  const id = await chatId(page);
  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(pane).toBeHidden();

  const push = (tabs: unknown[]) =>
    page.evaluate(
      ({ chat, tabs }) =>
        (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
          chat,
          tabs,
        ),
      { chat: id, tabs },
    );
  await push([{ title: 'Mine', url: 'http://localhost:5173/', active: true, loading: true }]);
  await expect(pane).toBeHidden();

  await push([
    { title: 'Mine', url: 'http://localhost:5173/' },
    {
      title: 'Docs',
      url: 'http://localhost:5173/docs',
      owner: 'agent',
      driving: true,
      active: true,
    },
  ]);
  await expect(pane).toBeVisible();
  const notice = pane.getByRole('group', { name: 'Opened by the agent' });
  await expect(notice).toContainText('The agent opened Docs');

  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(pane).toBeHidden();
  await push([
    { title: 'Mine', url: 'http://localhost:5173/' },
    {
      title: 'Docs',
      url: 'http://localhost:5173/docs2',
      owner: 'agent',
      driving: true,
      active: true,
    },
  ]);
  await expect(pane).toBeHidden();

  await toggleHeaderPane(page, 'Browser');
  await expect(pane).toBeVisible();
  await expect(notice).toHaveCount(0);
});
