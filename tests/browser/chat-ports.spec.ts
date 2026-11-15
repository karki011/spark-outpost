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
const chip = (page: Page, port: number) =>
  page
    .getByRole('region', { name: 'Chat context' })
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

test("a port a shell tab listens on shows in its chat's context rail, not on the row, and opens in that chat's pane", async ({
  page,
}) => {
  await withDesktopBrowser(page);
  await page.setViewportSize({ width: 2000, height: 1000 });
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

  await expect(chip(page, port)).toBeVisible({ timeout: 15_000 });
  await expect(chip(page, port)).toHaveText(`localhost:${port}`);
  await expect(page.locator(`[data-chat="${building}"]`)).not.toContainText(`:${port}`);
  const box = await chip(page, port).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(28);

  await row(page, other).click();
  await expect(page.locator('.chat-title')).toHaveText('Something else');
  await expect(chip(page, port)).toHaveCount(0);

  await row(page, building).click();
  await expect(page.locator('.chat-title')).toHaveText('Build the app');
  await chip(page, port).focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => calls(page, 'command'))
    .toContainEqual({
      chatId: building,
      command: { command: 'new_tab', url: `http://localhost:${port}/` },
    });

  await dock(page).locator('.xterm').click();
  await page.keyboard.press('Control+C');
  await expect(chip(page, port)).toHaveCount(0, { timeout: 15_000 });
});
