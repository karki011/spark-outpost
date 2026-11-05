import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { pointOf, startFixtureTerminal, typeLine } from './native-terminal-fixture.ts';

const PLAIN = 'https://example.com/plain-link';
const HYPERLINK = 'https://example.com/osc-link';

interface Sent {
  command: { command: string; url?: string };
}

test.beforeEach(async ({ context }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Example</title>' }),
  );
});

const opened = async (page: Page) =>
  ((await calls(page, 'command')) as Sent[])
    .map((call) => call.command)
    .filter((command) => command.command === 'new_tab');

async function withLinks(page: Page): Promise<Locator> {
  const workspace = await startFixtureTerminal(page);
  await typeLine(page, workspace, 'fixture mouse on');
  await typeLine(page, workspace, 'fixture links');
  await expect(workspace.locator('.xterm-accessibility')).toContainText('the docs too');
  return workspace;
}

async function hover(page: Page, workspace: Locator, text: string) {
  let point = { x: 0, y: 0 };
  await expect(async () => {
    point = await pointOf(workspace, text);
    await page.mouse.move(point.x - 30, point.y - 20);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await expect(workspace.locator('.xterm-cursor-pointer')).toHaveCount(1, { timeout: 1000 });
  }).toPass();
  return point;
}

test('a click on a link in a Terminal session opens it in the Browser pane while the CLI reads the mouse', async ({
  page,
}) => {
  await withDesktopBrowser(page);
  const workspace = await withLinks(page);
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeHidden();

  const plain = await hover(page, workspace, PLAIN);
  await page.mouse.click(plain.x, plain.y);
  await expect.poll(() => opened(page)).toEqual([{ command: 'new_tab', url: PLAIN }]);
  await expect(pane).toBeVisible();

  const hyperlink = await hover(page, workspace, 'the docs');
  await page.mouse.click(hyperlink.x, hyperlink.y);
  await expect
    .poll(async () => (await opened(page)).at(-1))
    .toEqual({ command: 'new_tab', url: HYPERLINK });
});

test('a right click on a terminal link offers the pane, the default browser and Copy link', async ({
  page,
  context,
}) => {
  await withDesktopBrowser(page);
  const workspace = await withLinks(page);
  const plain = await hover(page, workspace, PLAIN);

  await page.mouse.click(plain.x, plain.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Link options' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Open in Spark browser',
    'Open in default browser',
    'Copy link',
  ]);
  await menu.getByRole('menuitem', { name: 'Copy link' }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PLAIN);
  expect(await opened(page)).toEqual([]);

  await hover(page, workspace, PLAIN);
  await page.mouse.click(plain.x, plain.y, { button: 'right' });
  const [outside] = await Promise.all([
    context.waitForEvent('page'),
    menu.getByRole('menuitem', { name: 'Open in default browser' }).click(),
  ]);
  await expect(outside).toHaveURL(PLAIN);
  await outside.close();

  await hover(page, workspace, PLAIN);
  await page.mouse.click(plain.x, plain.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Open in Spark browser' }).click();
  await expect.poll(() => opened(page)).toEqual([{ command: 'new_tab', url: PLAIN }]);
});

test('a right click that is not on a link shows no link menu', async ({ page }) => {
  await withDesktopBrowser(page);
  const workspace = await withLinks(page);
  const away = await pointOf(workspace, 'Ready for terminal input');
  await page.mouse.move(away.x, away.y, { steps: 3 });
  await expect(workspace.locator('.xterm-cursor-pointer')).toHaveCount(0);
  await page.mouse.click(away.x, away.y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Link options' })).toHaveCount(0);
  await page.mouse.click(away.x, away.y);
  expect(await opened(page)).toEqual([]);
});

test('without the Mac app a terminal link opens in a new browser tab', async ({
  page,
  context,
}) => {
  const workspace = await withLinks(page);
  const plain = await hover(page, workspace, PLAIN);
  const [outside] = await Promise.all([
    context.waitForEvent('page'),
    page.mouse.click(plain.x, plain.y),
  ]);
  await expect(outside).toHaveURL(PLAIN);
  await outside.close();

  await page.mouse.click(plain.x, plain.y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Link options' }).getByRole('menuitem')).toHaveText([
    'Open in default browser',
    'Copy link',
  ]);
});
