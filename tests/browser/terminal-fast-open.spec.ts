import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const TERMINAL_CODE =
  /\/(src\/terminal\/xterm-terminal\.ts|assets\/xterm-terminal-[\w-]+\.js)(\?|$)/;
const HELD_STREAMS = 4;

let base = '';

test.beforeEach(async () => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-terminal-fast-open-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const dock = (page: Page) => page.getByRole('region', { name: 'Terminal' });

async function newChatIn(page: Page, root: string) {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(root)}`) }).click();
  await page.keyboard.press('Escape');
}

function holdTerminalCode(page: Page) {
  const held: Route[] = [];
  let released = false;
  const asked = new Promise<void>((resolve) => {
    void page.route(TERMINAL_CODE, (route) => {
      if (released) return route.continue();
      held.push(route);
      resolve();
    });
  });
  return {
    asked,
    held: () => held.length,
    release: async () => {
      released = true;
      await Promise.all(held.map((route) => route.continue()));
    },
  };
}

function holdEventStreams(page: Page, count: number) {
  return page.evaluate((streams) => {
    for (let index = 0; index < streams; index += 1) {
      new EventSource(`/api/events?held=${index}`);
    }
  }, count);
}

test('the dock asks for its shell while the terminal code is still loading @packaged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1300, height: 860 });
  const code = holdTerminalCode(page);
  const root = path.join(base, 'widgets');
  mkdirSync(root);
  await newChatIn(page, root);
  await code.asked;
  await holdEventStreams(page, HELD_STREAMS);

  const shellAsked = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/terminal/shells'),
  );
  await page.keyboard.press('Control+Backquote');
  await shellAsked;
  expect(code.held()).toBeGreaterThan(0);

  await expect(
    dock(page).getByRole('button', { name: 'my files · widgets', exact: true }),
  ).toBeVisible();
  await expect(dock(page).locator('.term-light.starting')).toBeVisible();
  await expect(dock(page).locator('.term-skel')).toBeVisible();

  await code.release();
  await expect(dock(page).locator('.term-light.open')).toBeVisible();
  await expect(dock(page).locator('.xterm-helper-textarea')).toBeFocused();
});

test('the dock opens with several event streams held @packaged', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1300, height: 860 });
  const root = path.join(base, 'gadgets');
  mkdirSync(root);
  const codeLoaded = page.waitForResponse(TERMINAL_CODE);
  await newChatIn(page, root);
  await codeLoaded;
  await holdEventStreams(page, HELD_STREAMS);

  const pressed = Date.now();
  await page.keyboard.press('Control+Backquote');
  await expect(dock(page).locator('.term-light.open')).toBeVisible();
  await expect(dock(page).locator('.xterm-helper-textarea')).toBeFocused();
  const openMs = Date.now() - pressed;
  test.info().annotations.push({ type: 'dock open', description: `${openMs} ms` });
  expect(openMs).toBeLessThan(5_000);
});
