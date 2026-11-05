import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';

test.describe.configure({ timeout: 60_000 });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const dock = (page: Page) => page.getByRole('region', { name: 'Terminal' });
const row = (page: Page, id: string) => page.locator(`[data-chat="${id}"] .row-open`);
const chip = (page: Page, id: string, port: number) =>
  page
    .locator(`[data-chat="${id}"]`)
    .getByRole('button', { name: `Open localhost:${port} in the Browser pane` });

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

async function savedChat(page: Page, title: string): Promise<string> {
  const id = randomUUID();
  expect((await page.request.post('/api/conversations', { data: { id } })).status()).toBe(201);
  const sent = await page.request.post(`/api/conversations/${id}/messages`, {
    data: { id: randomUUID(), content: title, attachmentIds: [], annotations: [], source: 'ui' },
  });
  expect(sent.ok()).toBe(true);
  return id;
}

test("a port a shell tab listens on shows on its chat's row and opens in that chat's pane", async ({
  page,
}) => {
  await withDesktopBrowser(page);
  await page.setViewportSize({ width: 1300, height: 860 });
  await page.goto('/');
  const building = await savedChat(page, 'Build the app');
  const other = await savedChat(page, 'Something else');
  const port = await freePort();
  await openChats(page);
  await row(page, building).click();
  await expect(page.locator('.chat-title')).toHaveText('Build the app');
  await toggleHeaderPane(page, 'Terminal');
  await expect(dock(page).locator('.term-light.open')).toBeVisible();
  await dock(page).locator('.xterm').click();
  await page.keyboard.type(`python3 -m http.server ${port} --bind 127.0.0.1`);
  await page.keyboard.press('Enter');

  await row(page, other).click();
  await expect(page.locator('.chat-title')).toHaveText('Something else');
  await expect(chip(page, building, port)).toBeVisible({ timeout: 15_000 });
  await expect(chip(page, building, port)).toHaveText(`:${port}`);
  await expect(page.locator(`[data-chat="${other}"] .row-port`)).toHaveCount(0);
  const box = await chip(page, building, port).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(28);

  await chip(page, building, port).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-title')).toHaveText('Build the app');
  await expect
    .poll(async () => calls(page, 'command'))
    .toContainEqual({
      chatId: building,
      command: { command: 'new_tab', url: `http://localhost:${port}/` },
    });

  await dock(page).locator('.xterm').click();
  await page.keyboard.press('Control+C');
  await expect(chip(page, building, port)).toHaveCount(0, { timeout: 15_000 });
});

test('the web app asks for no ports and shows no chips', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/chat-ports') asked.push(request.url());
  });
  await page.setViewportSize({ width: 1300, height: 860 });
  await page.goto('/');
  const building = await savedChat(page, 'Build the app');
  const port = await freePort();
  await openChats(page);
  await row(page, building).click();
  await toggleHeaderPane(page, 'Terminal');
  await expect(dock(page).locator('.term-light.open')).toBeVisible();
  await dock(page).locator('.xterm').click();
  await page.keyboard.type(`python3 -m http.server ${port} --bind 127.0.0.1`);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await (await page.request.get('/api/chat-ports')).json()) as unknown, {
      timeout: 15_000,
    })
    .toEqual({ ports: { [building]: [port] } });
  await expect(page.locator('.row-port')).toHaveCount(0);
  expect(asked).toEqual([]);
  await dock(page).locator('.xterm').click();
  await page.keyboard.press('Control+C');
});
