import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { startFixtureTerminal, typeLine } from './native-terminal-fixture.ts';
import { FONT_HOSTS, probeFonts, probeStack, tableShot } from './terminal-font-probe.ts';

const MONO = "'Geist Mono', ui-monospace, Menlo, monospace";
const SANS = "'Geist', ui-sans-serif, system-ui, sans-serif";
const MENLO = 'Menlo';
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

function plainFamily(family: string): string {
  return family
    .replace(/["']/g, '')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

function terminalToken(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--font-terminal'),
  );
}

function drawnFamily(workspace: Locator): Promise<string> {
  return workspace.locator('.xterm').evaluate((root) => {
    const input = root.querySelector('.xterm-helper-textarea')!;
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'x' }));
    const family = root.querySelector<HTMLElement>('.composition-view')!.style.fontFamily;
    input.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
    return family;
  });
}

async function steadyShot(page: Page, workspace: Locator): Promise<Buffer> {
  let shot = await tableShot(page, workspace);
  await expect
    .poll(async () => {
      const previous = shot;
      shot = await tableShot(page, workspace);
      return shot.equals(previous);
    })
    .toBe(true);
  return shot;
}

test('the terminal draws in the terminal font, the app keeps its bundled fonts, and no font host is asked @packaged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const asked = await blockFontHosts(page);
  const workspace = await startFixtureTerminal(page);
  await typeLine(page, workspace, 'fixture fonts');

  const token = await terminalToken(page);
  expect(plainFamily(token)).toBe('SF Mono,Menlo,monospace');
  expect(plainFamily(await drawnFamily(workspace))).toBe(plainFamily(token));

  const mono = await probeFonts(page, MONO);
  expect(mono.regular).toBe(true);
  expect(mono.boldFace).toBe(true);
  const sans = await probeFonts(page, SANS);
  expect(sans.regular).toBe(true);

  const drawn = await steadyShot(page, workspace);
  await page.route(BUNDLED_FONT_FILES, (route) => route.abort());
  const reopened = await reopenTerminal(page);
  await expect.poll(async () => (await tableShot(page, reopened)).equals(drawn)).toBe(true);
  expect(asked).toEqual([]);
});

test('without SF Mono installed, regular and bold terminal text is Menlo at one width', async ({
  page,
}) => {
  await page.goto('/');
  const stack = (await terminalToken(page)).trim();
  expect(plainFamily(stack)).toBe('SF Mono,Menlo,monospace');
  const probe = await probeStack(page, stack, MENLO);
  test.skip(!probe.regularLikeReference, 'SF Mono is installed on this machine');

  expect(probe.boldLikeReference).toBe(true);
  expect(probe.inked).toBe(true);
  expect(probe.boldWidth).toBeCloseTo(probe.regularWidth, 1);
});

test('a terminal opened before the bundled fonts arrived settles on the same drawing as one opened after', async ({
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
  expect(await page.evaluate(() => document.fonts.status)).toBe('loading');

  release();
  await expect.poll(async () => (await probeFonts(page, MONO)).boldFace).toBe(true);
  const arrived = await steadyShot(page, workspace);

  await page.unroute(BUNDLED_FONT_FILES);
  const reopened = await reopenTerminal(page);
  await expect.poll(async () => (await tableShot(page, reopened)).equals(arrived)).toBe(true);
});
