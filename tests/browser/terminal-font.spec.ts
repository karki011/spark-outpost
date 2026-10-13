import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { startFixtureTerminal, typeLine } from './native-terminal-fixture.ts';
import { FONT_HOSTS, probeFonts, tableShot } from './terminal-font-probe.ts';

const MONO = "'Geist Mono', ui-monospace, Menlo, monospace";
const SANS = "'Geist', ui-sans-serif, system-ui, sans-serif";
const BUNDLED_FONT_FILES = '**/fonts/*.woff2';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

async function blockFontHosts(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(FONT_HOSTS, (route) => {
    asked.push(route.request().url());
    return route.abort();
  });
  return asked;
}

async function openChatsBeforeFontsLoad(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Chats/ })
    .click();
}

async function reopenTerminal(page: Page) {
  await page.reload();
  const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
  await expect(workspace.locator('.xterm-accessibility')).toContainText(']: fixture fonts');
  return workspace;
}

test('the terminal draws regular and bold text in the bundled mono font with the font hosts blocked @packaged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const asked = await blockFontHosts(page);
  const workspace = await startFixtureTerminal(page);
  await typeLine(page, workspace, 'fixture fonts');

  const mono = await probeFonts(page, MONO);
  expect(mono.regular).toBe(true);
  expect(mono.bold).toBe(true);
  expect(mono.boldFace).toBe(true);
  expect(mono.boldWidth).toBeCloseTo(mono.regularWidth, 1);
  const sans = await probeFonts(page, SANS);
  expect(sans.regular).toBe(true);
  expect(asked).toEqual([]);

  const drawn = await tableShot(page, workspace);
  await page.route(BUNDLED_FONT_FILES, (route) => route.abort());
  const withoutFont = await tableShot(page, await reopenTerminal(page));
  expect(withoutFont.equals(drawn)).toBe(false);
});

test('a terminal opened before the font arrived is drawn again in it, and stays so after a reload', async ({
  page,
}) => {
  test.setTimeout(60_000);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(BUNDLED_FONT_FILES, async (route) => {
    await held;
    await route.continue();
  });
  const workspace = await startFixtureTerminal(page, openChatsBeforeFontsLoad);
  await typeLine(page, workspace, 'fixture fonts');
  await page.evaluate(
    () => new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn))),
  );
  expect(await page.evaluate(() => document.fonts.status)).toBe('loading');

  release();
  await expect.poll(async () => (await probeFonts(page, MONO)).boldFace).toBe(true);
  let arrived = await tableShot(page, workspace);
  await expect
    .poll(async () => {
      const previous = arrived;
      arrived = await tableShot(page, workspace);
      return arrived.equals(previous);
    })
    .toBe(true);

  await page.unroute(BUNDLED_FONT_FILES);
  const reopened = await reopenTerminal(page);
  await expect.poll(async () => (await tableShot(page, reopened)).equals(arrived)).toBe(true);
});
