import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = 'test-results/boot-screen';
const GRAPHITE_BG = 'rgb(12, 15, 18)';
const FJORD_BG = 'rgb(237, 241, 245)';

interface Teaser {
  label: string;
  text: string;
}

async function fakeBootBridge(page: Page, teasers?: Teaser[]) {
  await page.addInitScript((teasers) => {
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
        ...(teasers ? { teasers: async () => teasers } : {}),
      },
    });
  }, teasers);
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
    await page.emulateMedia({ colorScheme: 'dark' });
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
    await page.goto('/boot.html?theme=auto.graphite.system');
    expect(await bootBackground(page)).toBe(GRAPHITE_BG);
    await page.goto('/boot.html?theme=auto.sage.system');
    expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('loam');
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
    await page.goto('/boot.html?theme=auto.sage.system');
    expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('contrast-dark');
    await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });

    await page.goto('/boot.html?theme=%3Cscript%3E');
    expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('light');
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

const PARTY_SHOTS = 'test-results/boot-party';
const SKINS = [
  'light',
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'contrast',
] as const;
const TEASERS: Teaser[] = [
  { label: 'While you were away', text: 'Wren is waiting on you 👀' },
  { label: 'While you were away', text: '2 chats were still running when you left…' },
  { label: 'New in 0.1.0-beta.1', text: 'Updates in the background on Stable or Beta' },
  { label: 'Tip', text: '⌥Space starts a chat from anywhere' },
];

const classesOf = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements) => elements.map((element) => element.className));

const runningAnimations = (page: Page) =>
  page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === 'running').length,
  );

function reactionTo(page: Page, text: string) {
  return page.evaluate((line) => {
    const { bootBridge } = window as unknown as { bootBridge: { status: (t: string) => void } };
    bootBridge.status(line);
    return {
      fiveRight: document.querySelectorAll('.pb.five-right').length,
      fiveLeft: document.querySelectorAll('.pb.five-left').length,
      cheering: document.querySelectorAll('.pb-hop.cheer').length,
      sleeperAwake: !document.querySelector('.pb-sleeper')?.classList.contains('sleeping'),
    };
  }, text);
}

async function recordFrames(page: Page, name: string, frames: number) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.screenshot({ path: `${PARTY_SHOTS}/${name}-${String(frame).padStart(2, '0')}.png` });
    await page.waitForTimeout(220);
  }
}

test.describe('boot party', () => {
  test('a decorative blob party cheers each startup step and jumps into Spark at the end', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await fakeBootBridge(page);
    await page.goto('/boot.html');
    const party = page.locator('.party');
    await expect(party).toHaveAttribute('aria-hidden', 'true');
    await expect(party.locator('.pb')).toHaveCount(6);
    await expect(party.locator('.pb-sleeper.sleeping')).toHaveCount(1);
    await expect(party.locator('.pb-juggler .pb-balls i')).toHaveCount(3);
    await expect(page.locator('.pb-peeker')).toHaveCount(1);
    await sendStatus(page, 'Waking up…');
    await page.waitForTimeout(1_600);
    await page.screenshot({ path: `${PARTY_SHOTS}/party-dark.png` });

    expect(await reactionTo(page, 'Starting the database…')).toEqual({
      fiveRight: 1,
      fiveLeft: 1,
      cheering: 5,
      sleeperAwake: true,
    });
    await expect(page.getByRole('status')).toHaveText('Starting the database…');
    await recordFrames(page, 'frames-dark', 8);
    await expect(party.locator('.pb-sleeper')).toHaveClass(/sleeping/, { timeout: 5_000 });

    await sendStatus(page, 'Starting Spark…');
    await expect(party).toHaveClass(/huddle/);
    await expect(party.locator('.pb.happy')).toHaveCount(6);
    await expect(party.locator('.pb-sleeper')).not.toHaveClass(/sleeping/);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${PARTY_SHOTS}/huddle-dark.png` });

    await page.evaluate(() => {
      (window as unknown as { bootBridge: { leave: () => void } }).bootBridge.leave();
    });
    await expect(party).toHaveClass(/joining/);
    await expect
      .poll(() => page.locator('.boot').evaluate((element) => getComputedStyle(element).opacity))
      .toBe('0');
  });

  test('teases what happened while you were away, one card at a time', async ({ page }) => {
    test.setTimeout(60_000);
    await fakeBootBridge(page, TEASERS);
    await page.goto('/boot.html?theme=fjord');
    await sendStatus(page, 'Starting the database…');
    const teaser = page.locator('.teaser');
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>('.teaser')?.dataset.phase === 'arrive',
      undefined,
      { polling: 'raf' },
    );
    await expect(teaser).toHaveAttribute('aria-hidden', 'true');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${PARTY_SHOTS}/teaser-peek-light.png` });
    await expect(teaser).toHaveAttribute('data-phase', 'reveal');
    await expect(teaser.locator('.teaser-front')).toHaveText(
      'While you were awayWren is waiting on you 👀',
    );
    await expect(page.locator('.teaser-text')).toHaveCount(1);
    await expect(page.locator('.boot-sr')).toHaveText(
      'While you were away: Wren is waiting on you. While you were away: 2 chats were still running when you left. New in 0.1.0-beta.1: Updates in the background on Stable or Beta. Tip: ⌥Space starts a chat from anywhere.',
    );
    await expect(page.locator('.boot-sr')).toHaveAttribute('aria-live', 'polite');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${PARTY_SHOTS}/teaser-light.png` });
    await recordFrames(page, 'frames-light', 6);

    await expect(teaser.locator('.teaser-text')).toHaveText(
      '2 chats were still running when you left…',
      { timeout: 8_000 },
    );
    await expect(page.getByRole('status')).toHaveText('Starting the database…');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/boot.html?theme=graphite');
    await sendStatus(page, 'Updating your data…');
    await expect(page.locator('.teaser')).toHaveAttribute('data-phase', 'reveal');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${PARTY_SHOTS}/teaser-dark.png` });
  });

  test('stands still for a group portrait when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fakeBootBridge(page, TEASERS);
    await page.goto('/boot.html?theme=fjord');
    await sendStatus(page, 'Waking up…');
    await expect(page.locator('.party .pb')).toHaveCount(6);
    await expect(page.locator('.pb-peeker')).toBeHidden();
    await expect(page.locator('.teaser')).toHaveAttribute('data-phase', 'reveal');
    await expect(page.locator('.teaser-front')).toBeVisible();
    await sendStatus(page, 'Starting the database…');
    await sendStatus(page, 'Starting Spark…');
    await expect(page.getByRole('status')).toHaveText('Starting Spark…');
    expect(await runningAnimations(page)).toBe(0);
    expect(await classesOf(page, '.pb-hop.cheer, .pb.five-left, .party.huddle')).toEqual([]);
    await page.screenshot({ path: `${PARTY_SHOTS}/portrait-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/boot.html?theme=graphite');
    await expect(page.locator('.teaser')).toHaveAttribute('data-phase', 'reveal');
    expect(await runningAnimations(page)).toBe(0);
    await page.screenshot({ path: `${PARTY_SHOTS}/portrait-dark.png` });
  });

  for (const size of [
    { width: 360, height: 420 },
    { width: 480, height: 360 },
    { width: 800, height: 500 },
  ]) {
    test(`fits a ${size.width}×${size.height} window without overflowing`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await fakeBootBridge(page, TEASERS);
      await page.goto('/boot.html');
      await sendStatus(page, 'Updating your data…');
      await expect(page.locator('.teaser')).toHaveAttribute('data-phase', 'reveal');
      const overflow = await page.evaluate(() => {
        const inside = (element: Element) => {
          const box = element.getBoundingClientRect();
          return (
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= window.innerWidth &&
            box.bottom <= window.innerHeight
          );
        };
        const scroller = document.scrollingElement ?? document.documentElement;
        return {
          scrolls:
            scroller.scrollWidth > window.innerWidth || scroller.scrollHeight > window.innerHeight,
          outside: [
            ...document.querySelectorAll('.pb-face, .teaser-card, .boot-blob, .boot-status span'),
          ]
            .filter((element) => !inside(element))
            .map((element) => element.className),
        };
      });
      expect(overflow).toEqual({ scrolls: false, outside: [] });
      await page.screenshot({ path: `${PARTY_SHOTS}/fit-${size.width}x${size.height}.png` });
    });
  }

  test('teaser cards and the status line keep readable contrast in every theme', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fakeBootBridge(page, TEASERS);
    const failures: string[] = [];
    const looks = [
      ...SKINS.map((skin) => ({ skin, scheme: 'dark' as const })),
      { skin: 'system', scheme: 'light' as const },
      { skin: 'system', scheme: 'dark' as const },
      { skin: 'dark.sage.system', scheme: 'dark' as const },
      { skin: 'dark.graphite.always', scheme: 'dark' as const },
    ];
    for (const { skin, scheme } of looks) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/boot.html?theme=${skin}`);
      await sendStatus(page, 'Starting the database…');
      await expect(page.locator('.teaser')).toHaveAttribute('data-phase', 'reveal');
      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      for (const violation of results.violations) {
        failures.push(
          `${skin} ${scheme}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
        );
      }
    }
    expect(failures).toEqual([]);
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
    await page.getByRole('menuitemradio', { name: 'Fjord · Void' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'fjord');
    expect(
      await page.evaluate(() => (window as unknown as { desktopCalls: string[] }).desktopCalls),
    ).toEqual(['rendered', 'save:light.fjord.system']);
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
