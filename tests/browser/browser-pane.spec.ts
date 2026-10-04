import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

interface PaneCall {
  kind: string;
  payload: unknown;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

async function withDesktopBrowser(page: Page) {
  await page.addInitScript(() => {
    const calls: { kind: string; payload: unknown }[] = [];
    const stateListeners = new Set<(state: unknown) => void>();
    const snapshotListeners = new Set<(snapshot: unknown) => void>();
    const pickListeners = new Set<(pick: unknown) => void>();
    const noop = () => () => undefined;
    const tab = (id: string, change: Record<string, unknown>) => ({
      id,
      title: '',
      url: '',
      owner: 'user',
      active: false,
      place: 'local',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      pinned: false,
      driving: false,
      picking: false,
      error: null,
      ...change,
    });
    Object.assign(window, {
      browserCalls: calls,
      browserPush: (chatId: string, tabs: Record<string, unknown>[]) => {
        const state = { chatId, tabs: tabs.map((item, index) => tab(`t${index + 1}`, item)) };
        stateListeners.forEach((listener) => listener(state));
      },
      browserSnapshot: (chatId: string, image: string | null) =>
        snapshotListeners.forEach((listener) => listener({ chatId, image })),
      browserPick: (pick: unknown) => pickListeners.forEach((listener) => listener(pick)),
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: noop },
        island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
        updates: { get: async () => null, onChange: noop },
        onOpenChat: noop,
        browser: {
          state: async () => null,
          place: async (placement: unknown) => calls.push({ kind: 'place', payload: placement }),
          command: async (chatId: string, command: unknown) =>
            calls.push({ kind: 'command', payload: { chatId, command } }),
          start: async (placement: { chatId: string }) => {
            calls.push({ kind: 'start', payload: placement });
            return { chatId: placement.chatId, tabs: [tab('t1', { active: true })] };
          },
          sites: async () => [{ origin: 'http://localhost', cookies: 2 }],
          signOut: async (projectId: string, origin: string | null) => {
            calls.push({ kind: 'signOut', payload: { projectId, origin } });
            return [];
          },
          onState: (listener: (state: unknown) => void) => {
            stateListeners.add(listener);
            return () => stateListeners.delete(listener);
          },
          onSnapshot: (listener: (snapshot: unknown) => void) => {
            snapshotListeners.add(listener);
            return () => snapshotListeners.delete(listener);
          },
          onPicked: (listener: (pick: unknown) => void) => {
            pickListeners.add(listener);
            return () => pickListeners.delete(listener);
          },
        },
      },
    });
  });
}

const calls = (page: Page, kind: string) =>
  page.evaluate(
    (wanted) =>
      (window as unknown as { browserCalls: PaneCall[] }).browserCalls
        .filter((call) => call.kind === wanted)
        .map((call) => call.payload),
    kind,
  );

async function openPane(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.head-r').getByRole('button', { name: 'Browser' }).click();
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeVisible();
  return pane;
}

async function chatId(page: Page): Promise<string> {
  const started = (await calls(page, 'start')) as { chatId: string }[];
  return started[0]!.chatId;
}

test('the web app has no Browser button', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.locator('.head-r').getByRole('button', { name: 'Terminal' })).toBeVisible();
  await expect(page.locator('.head-r').getByRole('button', { name: 'Browser' })).toHaveCount(0);
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
  const placed = (await calls(page, 'place')).at(-1);
  expect(placed).toMatchObject({ covered: false, projectId: null, keepSignIns: true });

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
  await expect(pane.getByRole('button', { name: 'My app', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(pane.getByRole('button', { name: 'Agent Docs' })).toBeVisible();
  await expect(address).toHaveValue('http://localhost:5173/');
  await expect(pane.getByRole('button', { name: 'Back' })).toBeEnabled();
  await expect(pane.getByRole('button', { name: 'Forward' })).toBeDisabled();

  await pane.getByRole('button', { name: 'My app', exact: true }).focus();
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
  await expect(pane.getByRole('button', { name: 'My app', exact: true })).toBeVisible();
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

test('a selected element lands on the draft as a note and a picture', async ({ page }) => {
  await withDesktopBrowser(page);
  await openPane(page);
  const id = await chatId(page);
  await page.evaluate((chat) => {
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
      image:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    });
  }, id);
  await expect(page.getByText('selected-button-buy.txt')).toBeVisible();
  await expect(
    page.locator('img[alt*="selected-button-buy.png"], [title*="selected-button-buy.png"]').first(),
  ).toBeAttached();
});
