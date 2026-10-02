import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = 'test-results/boot-screen';
const GRAPHITE_BG = 'rgb(12, 15, 18)';
const FJORD_BG = 'rgb(237, 241, 245)';

async function fakeBootBridge(page: Page) {
  await page.addInitScript(() => {
    const bridge = {
      painted: 0,
      status: null as ((text: string) => void) | null,
      leave: null as (() => void) | null,
    };
    Object.assign(window, {
      bootBridge: bridge,
      sparkBoot: {
        onStatus: (callback: (text: string) => void) => {
          bridge.status = callback;
        },
        onLeave: (callback: () => void) => {
          bridge.leave = callback;
        },
        painted: () => {
          bridge.painted += 1;
        },
      },
    });
  });
}

function sendStatus(page: Page, text: string) {
  return page.evaluate((line) => {
    const { bootBridge } = window as unknown as { bootBridge: { status: (t: string) => void } };
    bootBridge.status(line);
  }, text);
}

const bootBackground = (page: Page) =>
  page.locator('.boot').evaluate((element) => getComputedStyle(element).backgroundColor);

test.describe('boot screen', () => {
  test('wakes up in the default theme and follows the startup steps', async ({ page }) => {
    await fakeBootBridge(page);
    await page.goto('/boot.html');
    const status = page.getByRole('status');
    await expect(page.getByRole('main', { name: 'Spark Outpost is starting' })).toBeVisible();
    expect(await bootBackground(page)).toBe(GRAPHITE_BG);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { bootBridge: { painted: number } }).bootBridge.painted,
        ),
      )
      .toBe(1);

    for (const line of [
      'Waking up…',
      'Starting the database…',
      'Backing up before the update…',
      'Updating your data…',
      'Starting Spark…',
    ]) {
      await sendStatus(page, line);
      await expect(status).toHaveText(line);
    }
    await page.waitForTimeout(1_800);
    await page.screenshot({ path: `${SHOTS}/boot-dark.png` });

    await page.evaluate(() => {
      (window as unknown as { bootBridge: { leave: () => void } }).bootBridge.leave();
    });
    await expect
      .poll(() => page.locator('.boot').evaluate((element) => getComputedStyle(element).opacity))
      .toBe('0');
  });

  test('uses the saved theme and the system setting', async ({ page }) => {
    await fakeBootBridge(page);
    await page.goto('/boot.html?theme=fjord');
    expect(await bootBackground(page)).toBe(FJORD_BG);
    await sendStatus(page, 'Starting the database…');
    await page.waitForTimeout(1_800);
    await page.screenshot({ path: `${SHOTS}/boot-light.png` });

    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/boot.html?theme=system');
    expect(await bootBackground(page)).toBe('rgb(244, 245, 247)');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await bootBackground(page)).toBe(GRAPHITE_BG);

    await page.goto('/boot.html?theme=%3Cscript%3E');
    expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('graphite');
  });

  test('shows a still, awake face when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fakeBootBridge(page);
    await page.goto('/boot.html');
    const eye = page.locator('.bb-eye').first();
    expect(await eye.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    expect(await eye.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
    expect(
      await page.locator('.bb-closed').evaluate((element) => getComputedStyle(element).opacity),
    ).toBe('0');
    await sendStatus(page, 'Updating your data…');
    await expect(page.getByRole('status')).toHaveText('Updating your data…');
  });
});

test.describe('first paint', () => {
  test('the shell paints a themed skeleton before the app script runs', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'fjord'));
    await page.route(/\/(src|assets)\/.*\.(tsx?|js)(\?.*)?$/, (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#shell-skeleton')).toBeVisible();
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
    ).toBe(FJORD_BG);
    await page.screenshot({ path: `${SHOTS}/shell-skeleton-light.png` });
  });

  test('the island page is transparent from its first frame', async ({ page }) => {
    await page.route(/\/(src|assets)\/.*\.(tsx?|js)(\?.*)?$/, (route) => route.abort());
    await page.goto('/island');
    expect(await page.evaluate(() => document.documentElement.dataset.island)).toBe('');
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
    ).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('#shell-skeleton')).toBeHidden();
  });

  test('the desktop theme seeds a fresh window, the app reports its first content once and saves theme changes', async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await page.addInitScript(() => {
      const calls: string[] = [];
      const none = () => () => undefined;
      Object.assign(window, {
        desktopCalls: calls,
        sparkDesktop: {
          platform: 'darwin',
          theme: { saved: 'apricot', save: (theme: string) => calls.push(`save:${theme}`) },
          rendered: () => calls.push('rendered'),
          companion: { get: async () => null, onChange: none },
          island: { geometry: async () => null, onGeometry: none, onCommand: none },
          onOpenChat: none,
        },
      });
    });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('apricot');
    expect(await page.evaluate(() => localStorage.getItem('spark-outpost.theme'))).toBe('apricot');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.locator('#shell-skeleton')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { desktopCalls: string[] }).desktopCalls),
      )
      .toEqual(['rendered']);

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: /^Chats/ })
      .click();
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Fjord' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'fjord');
    expect(
      await page.evaluate(() => (window as unknown as { desktopCalls: string[] }).desktopCalls),
    ).toEqual(['rendered', 'save:fjord']);
  });

  test('the island reports ready once its blob has drawn and fades the blob in', async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await page.addInitScript(() => {
      const ready: number[] = [];
      const none = () => () => undefined;
      Object.assign(window, {
        islandReady: ready,
        sparkDesktop: {
          platform: 'darwin',
          companion: { get: async () => null, onChange: none },
          island: {
            geometry: async () => ({
              notch: false,
              top: 24,
              notchWidth: 0,
              docked: true,
              menuBar: 24,
            }),
            onGeometry: none,
            onCommand: none,
            sparkFocused: async () => false,
            onSparkFocus: none,
            onEscape: none,
            setInteractive: () => undefined,
            setFocusable: () => undefined,
            drag: () => undefined,
            openChat: () => undefined,
            setRestSize: () => undefined,
            ready: () => ready.push(performance.now()),
          },
          onOpenChat: none,
        },
      });
    });
    await page.goto('/island');
    await expect(page.getByRole('region', { name: 'Spark Island' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { islandReady: number[] }).islandReady.length),
      )
      .toBeGreaterThan(0);
    expect(
      await page
        .locator('.isl-scout-wrap')
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('isl-wake');
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
    ).toBe('rgba(0, 0, 0, 0)');
  });
});
