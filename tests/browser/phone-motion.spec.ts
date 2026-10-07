import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  denyWaitingPhones,
  NARROW,
  openPairingPage,
  openPhone,
  pairFromPhone,
  resetPhone,
  setFakeTailscale,
  startPairing,
  turnOn,
  WIDE,
} from './phone-support.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const FRAMES = 10;
const FRAME_GAP_MS = 160;

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await resetPhone();
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
  await denyWaitingPhones(page);
  await page.setViewportSize(WIDE);
});

test.afterAll(() => {
  setFakeTailscale(null);
});

function loops(scope: Locator, state: 'running' | 'paused' = 'running'): Promise<string[]> {
  return scope.evaluate(
    (root, wanted) =>
      root
        .getAnimations({ subtree: true })
        .filter((item) => item.playState === wanted && 'animationName' in item)
        .map((item) => (item as CSSAnimation).animationName)
        .sort(),
    state,
  );
}

async function frames(page: Page, target: Locator, name: string) {
  if (!SHOTS) return;
  const folder = path.join(SHOTS, 'frames', name);
  mkdirSync(folder, { recursive: true });
  for (let index = 0; index < FRAMES; index++) {
    await target.screenshot({ path: path.join(folder, `${String(index).padStart(2, '0')}.png`) });
    await page.waitForTimeout(FRAME_GAP_MS);
  }
}

async function showTab(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => next === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

function holdTurn(page: Page, to: 'on' | 'off') {
  let release = () => undefined as void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = () => undefined as void;
  const passed = new Promise<void>((resolve) => {
    sent = resolve;
  });
  const url = `**/api/remote/tailscale/${to}`;
  const ready = page.route(url, async (route) => {
    await held;
    await route.continue();
    sent();
  });
  return {
    ready,
    release: async () => {
      release();
      await passed;
      await page.unroute(url);
    },
  };
}

function placed(scene: Locator) {
  return scene.evaluate((root) => {
    const origin = root.getBoundingClientRect();
    const box = (selector: string) => {
      const rect = root.querySelector(selector)?.getBoundingClientRect();
      if (!rect) return null;
      return [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height].map(Math.round);
    };
    const blob = root.querySelector<HTMLElement>('.ph-scene-blob');
    return {
      stage: box('.ph-scene-stage'),
      qr: box('.ph-qr'),
      code: box('.ph-code-text'),
      ring: box('.ph-ring'),
      button: box('.ph-code .btn'),
      blob: blob ? [blob.offsetLeft, blob.offsetTop, blob.offsetWidth, blob.offsetHeight] : null,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

function qrMotion(scene: Locator) {
  return scene.evaluate((root) => {
    const qr = root.querySelector('.ph-qr');
    const names = [...(qr?.querySelectorAll('*') ?? [])].map(
      (part) => getComputedStyle(part).animationName,
    );
    for (let node = qr; node && node !== root.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      names.push(style.animationName, style.transform);
    }
    return {
      names: [...new Set(names)],
      running: qr?.getAnimations({ subtree: true }).length ?? -1,
    };
  });
}

test('the blob works while phone access turns on or off, and is unsure when it fails', async ({
  page,
}) => {
  const main = await openPhone(page);
  const scene = main.locator('.ph-scene');
  await expect(scene).toHaveAttribute('data-blob', 'asleep');
  expect((await loops(scene)).filter((name) => name.startsWith('ph-'))).toEqual([]);

  const on = holdTurn(page, 'on');
  await on.ready;
  await main.getByRole('switch', { name: 'Phone access' }).click();
  await expect(scene).toHaveAttribute('data-blob', 'working');
  await expect(scene).toHaveAttribute('data-stage', 'setup');
  await expect(scene.locator('.scout')).toHaveClass(/working/);
  await expect(main.getByRole('status').first()).toHaveText('Turning phone access on…');
  await expect.poll(() => loops(scene)).toEqual(expect.arrayContaining(['ph-bob', 'sc-spin']));
  await frames(page, scene, 'activating');
  await page.waitForTimeout(1200);
  await expect(scene).toHaveAttribute('data-blob', 'working');
  await on.release();
  await expect(scene).toHaveAttribute('data-blob', 'ready');
  await expect(scene.locator('.scout')).not.toHaveClass(/working/);
  await expect(main.getByRole('button', { name: 'Pair a phone' })).toBeEnabled();

  const off = holdTurn(page, 'off');
  await off.ready;
  await main.getByRole('switch', { name: 'Phone access' }).click();
  await expect(scene).toHaveAttribute('data-blob', 'working');
  await expect(main.getByRole('status').first()).toHaveText('Turning phone access off…');
  await expect(main.getByRole('button', { name: 'Pair a phone' })).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await loops(scene.locator('.ph-scene-stage'))).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await off.release();
  await expect(scene).toHaveAttribute('data-blob', 'asleep');
  await expect(scene.locator('.scout')).toHaveClass(/sleep/);

  setFakeTailscale({ failServe: true });
  const refused = page.waitForResponse('**/api/remote/tailscale/on');
  await main.getByRole('switch', { name: 'Phone access' }).click();
  expect(await (await refused).json()).toMatchObject({ status: 'error' });
  const reread = await page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && response.url().endsWith('/api/remote/tailscale'),
  );
  expect(await reread.json()).toMatchObject({ status: 'off' });
  await page.waitForTimeout(500);
  await expect(scene).toHaveAttribute('data-blob', 'unsure');
  await expect(scene.locator('.scout')).toHaveClass(/sad/);
  await expect(main.getByRole('status').first()).toHaveText('Phone access did not turn on.');
  await expect(main.getByRole('alert')).toHaveText(/serve config denied/);
  await expect(main.getByRole('heading', { name: 'Phone access is off' })).toBeVisible();
  await frames(page, scene, 'activation-failed');

  setFakeTailscale(null);
  await main.getByRole('switch', { name: 'Phone access' }).click();
  await expect(scene).toHaveAttribute('data-blob', 'ready');
  await expect(main.getByRole('alert')).toHaveCount(0);
});

async function placedAtEachSize(page: Page, scene: Locator) {
  const seen = [];
  for (const size of [NARROW, WIDE]) {
    await page.setViewportSize(size);
    seen.push(await placed(scene));
  }
  return seen;
}

test('waiting motion follows the countdown and leaves the QR still, wide and at 390px', async ({
  page,
}) => {
  const main = await openPhone(page);
  const scene = main.locator('.ph-scene');
  await turnOn(page);
  await page.clock.install();
  await startPairing(page);
  await page.clock.pauseAt(new Date(Date.now() + 1000));

  await expect(scene).toHaveAttribute('data-blob', 'idle');
  await expect.poll(() => loops(scene)).toEqual(expect.arrayContaining(['ph-bob', 'ph-glance']));
  expect(await qrMotion(scene)).toEqual({ names: ['none'], running: 0 });
  const calm = await placedAtEachSize(page, scene);
  expect(calm.map((seen) => seen.overflow)).toEqual([false, false]);
  await frames(page, scene, 'waiting');

  await page.clock.fastForward(85_000);
  await expect(main.locator('.ph-ring-text')).toHaveText(/0:3[34]$/);
  await expect(scene).toHaveAttribute('data-blob', 'idle');
  await page.clock.fastForward(5_000);
  await expect(scene).toHaveAttribute('data-blob', 'alert');
  await expect(scene.locator('.scout')).toHaveClass(/alert/);
  await expect(scene).not.toHaveClass(/expiring/);
  await expect(main.locator('.ph-ring-text')).toHaveText(/0:2[89]$/);
  await expect.poll(() => loops(scene)).toEqual(expect.arrayContaining(['ph-hop', 'ph-watch']));
  expect(await placedAtEachSize(page, scene)).toEqual(calm);
  expect(await qrMotion(scene)).toEqual({ names: ['none'], running: 0 });
  await frames(page, scene, 'alert');

  await page.clock.fastForward(10_000);
  await expect(main.locator('.ph-ring-text')).toHaveText(/0:1[89]$/);
  await expect(scene).toHaveAttribute('data-blob', 'alert');
  await expect(scene).toHaveClass(/expiring/);
  expect(await placedAtEachSize(page, scene)).toEqual(calm);

  await page.clock.fastForward(10_000);
  await expect(scene).toHaveAttribute('data-blob', 'urgent');
  await expect(main.locator('.ph-ring-text')).toHaveText(/0:0[89]$/);
  await expect.poll(() => loops(scene)).toEqual(expect.arrayContaining(['ph-nudge', 'ph-watch']));
  expect(await loops(scene)).not.toContain('ph-hop');
  expect(await placedAtEachSize(page, scene)).toEqual(calm);
  expect(await qrMotion(scene)).toEqual({ names: ['none'], running: 0 });
  await frames(page, scene, 'urgent');

  await showTab(page, 'hidden');
  await expect(scene).toHaveAttribute('data-paused', 'true');
  expect(await loops(scene)).toEqual([]);
  expect(await loops(scene, 'paused')).toEqual(expect.arrayContaining(['ph-nudge', 'ph-watch']));
  await showTab(page, 'visible');
  await expect(scene).not.toHaveAttribute('data-paused');
  await expect.poll(() => loops(scene)).toContain('ph-nudge');

  await page.setViewportSize(NARROW);
  await main.locator('.ph-scroll').evaluate((scroller) => scroller.scrollTo(0, 100_000));
  await expect(scene).toHaveAttribute('data-paused', 'true');
  expect(await loops(scene)).toEqual([]);
  await main.locator('.ph-scroll').evaluate((scroller) => scroller.scrollTo(0, 0));
  await expect(scene).not.toHaveAttribute('data-paused');
  await page.setViewportSize(WIDE);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await loops(scene)).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.clock.fastForward(10_000);
  await expect(scene).toHaveAttribute('data-blob', 'shrug');
  await expect(scene).toHaveAttribute('data-stage', 'ended');
  await expect(scene.locator('.scout')).toHaveClass(/sad/);
});

test('a found phone gets an expectant loop until it is answered', async ({ page }) => {
  const main = await openPhone(page);
  const scene = main.locator('.ph-scene');
  await turnOn(page);
  await pairFromPhone(await startPairing(page), 'Kitchen phone');
  await expect(scene).toHaveAttribute('data-blob', 'expectant');
  await expect(main.getByRole('button', { name: 'Confirm' })).toBeFocused();
  await expect.poll(() => loops(scene)).toEqual(expect.arrayContaining(['ph-expect', 'ph-lean']));
  const waiting = await placed(scene);
  await page.waitForTimeout(1_000);
  expect(await placed(scene)).toEqual(waiting);
  await frames(page, scene, 'found');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await loops(scene)).toEqual([]);
  const look = await scene.locator('.sc-look').evaluate((eyes) => getComputedStyle(eyes).transform);
  expect(look).toBe('matrix(1, 0, 0, 1, 2.6, 0.4)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await main.getByRole('button', { name: 'Deny' }).click();
  await expect(scene).toHaveAttribute('data-blob', 'shrug');
  await expect(main.getByRole('button', { name: 'Try again' })).toBeFocused();
});

test('the pairing page blob idles, waits and shrugs, and stops for reduced motion', async ({
  page,
  browser,
}) => {
  const main = await openPhone(page);
  await turnOn(page);
  const code = await startPairing(page);
  const { context, phone } = await openPairingPage(browser, `#code=${code}`);
  const blocked: string[] = [];
  phone.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) blocked.push(message.text());
  });
  const stage = phone.locator('main');
  const blob = phone.locator('.scene');

  await expect(stage).toHaveAttribute('data-stage', 'enter');
  await expect.poll(() => loops(blob)).toEqual(expect.arrayContaining(['bob', 'glance', 'blink']));
  await frames(phone, blob, 'pairing-page-enter');

  await phone.getByLabel('Device name').fill('Kitchen phone');
  await phone.getByRole('button', { name: 'Pair' }).click();
  await expect(stage).toHaveAttribute('data-stage', 'waiting');
  await expect.poll(() => loops(blob)).toEqual(expect.arrayContaining(['lean', 'scan']));
  expect(await loops(blob)).not.toContain('bob');
  await frames(phone, blob, 'pairing-page-waiting');

  await showTab(phone, 'hidden');
  await expect(stage).toHaveAttribute('data-paused', '');
  expect(await loops(blob)).toEqual([]);
  await showTab(phone, 'visible');
  await expect(stage).not.toHaveAttribute('data-paused');

  await phone.emulateMedia({ reducedMotion: 'reduce' });
  expect(await loops(blob)).toEqual([]);
  await phone.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => loops(blob)).toContain('lean');

  await main.getByRole('button', { name: 'Deny' }).click();
  await expect(stage).toHaveAttribute('data-stage', 'ended', { timeout: 10_000 });
  const shrug = await blob.locator('.blob').evaluate((svg) => {
    const style = getComputedStyle(svg);
    return { name: style.animationName, count: style.animationIterationCount };
  });
  expect(shrug).toEqual({ name: 'shrug', count: '1' });
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  expect(await loops(blob)).toEqual([]);
  expect(await blob.locator('.blob').evaluate((svg) => getComputedStyle(svg).transform)).toMatch(
    /^matrix\(0\.99/,
  );
  await phone.emulateMedia({ reducedMotion: 'no-preference' });

  expect(blocked).toEqual([]);
  await context.close();
});
