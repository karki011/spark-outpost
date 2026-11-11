import { mkdirSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiNow } from './api-clock.ts';
import {
  chooseDeviceAction,
  denyWaitingPhones,
  NARROW,
  openPairingPage,
  openPhone,
  PHONE_ADDRESS,
  pairFromPhone,
  resetPhone,
  setFakeTailscale,
  startPairing,
  turnOn,
  WIDE,
} from './phone-support.ts';
import { animationsSettled } from './settle.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const LAYOUT_SIZES = [{ width: 1440, height: 900 }, WIDE, { width: 820, height: 900 }, NARROW];
const THEMES = [
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
];

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

async function shoot(page: Page, name: string, sizes = [WIDE, NARROW]): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const size of sizes) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({
        path: path.join(SHOTS, `${name}-${size.width}-${scheme}.png`),
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize(WIDE);
  await page.emulateMedia({ colorScheme: 'light' });
}

async function expectAccessible(page: Page, scope = '.ph') {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include(scope)
    .analyze();
  expect(axe.violations).toEqual([]);
}

async function expectEveryTheme(pages: [Page, string][], name: string) {
  for (const theme of THEMES) {
    for (const [page, scope] of pages) {
      await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
      await animationsSettled(page);
      await expectAccessible(page, scope);
      if (SHOTS) {
        const width = page.viewportSize()?.width ?? 0;
        await page.screenshot({
          path: path.join(SHOTS, `theme-${name}-${width}-${theme}.png`),
          animations: 'disabled',
        });
      }
    }
  }
  for (const [page] of pages) {
    await page.evaluate(() => delete document.documentElement.dataset.skin);
  }
}

test('sits above Settings in the left bar and asks to turn phone access on', async ({ page }) => {
  const main = await openPhone(page);
  const labels = await page
    .getByRole('navigation', { name: 'Main' })
    .locator('.rail-btn')
    .allTextContents();
  expect(labels.slice(-2)).toEqual(['Remote', 'Settings']);
  await expect(main.getByRole('heading', { name: 'Remote control is off' })).toBeVisible();
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'setup');
  await expect(main.locator('.ph-scene .scout')).toHaveClass(/sleep/);
  await expectAccessible(page);
  await shoot(page, 'phone-1-off');

  setFakeTailscale({ backendState: 'NeedsLogin' });
  await main.getByRole('switch', { name: 'Remote control' }).click();
  await expect(main.getByRole('heading', { name: 'Tailscale is not signed in' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Check again' })).toBeVisible();
  await shoot(page, 'phone-1-signed-out', [WIDE]);

  setFakeTailscale({ httpsEnabled: false });
  await main.getByRole('button', { name: 'Check again' }).click();
  await expect(main.getByRole('heading', { name: 'HTTPS certificates are off' })).toBeVisible();
});

test('turns on, pairs a phone through its pairing page, renames and revokes it', async ({
  page,
  browser,
}) => {
  const main = await openPhone(page);
  await turnOn(page);
  await expect(main.getByText(PHONE_ADDRESS)).toBeVisible();
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'ready');
  await expect(main.getByRole('button', { name: 'Pair a device' })).toBeFocused();

  const code = await startPairing(page);
  await expect(main.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(main.locator('.ph-ring-text')).toHaveText(/[12]:\d\d$/);
  await expect(main.getByRole('button', { name: 'Get a new code' })).toBeFocused();
  await expect(main.getByRole('status').first()).toHaveText(/Scan this with a phone/);
  const quiet = await main.locator('.ph-qr').evaluate((svg) => {
    const paper = getComputedStyle(svg.querySelector('.ph-qr-paper')!).fill;
    const ink = getComputedStyle(svg.querySelector('.ph-qr-ink')!).fill;
    return { paper, ink, animations: svg.getAnimations({ subtree: true }).length };
  });
  expect(quiet).toEqual({ paper: 'rgb(255, 255, 255)', ink: 'rgb(12, 15, 18)', animations: 0 });
  await expectAccessible(page);
  await shoot(page, 'phone-2-code', LAYOUT_SIZES);

  const { context: phoneContext, phone } = await openPairingPage(browser, `#code=${code}`);
  await expect(phone.getByLabel('Pairing code')).toHaveValue(code);
  await expect(phone.locator('main')).toHaveAttribute('data-stage', 'enter');
  await shoot(phone, 'pairing-page-1-enter', [NARROW]);
  await phone.getByLabel('Device name').fill('Kitchen phone');
  await phone.getByRole('button', { name: 'Pair' }).click();
  await expect(phone.locator('main')).toHaveAttribute('data-stage', 'waiting');
  await expect(phone.getByText('Confirm on your Mac.')).toBeVisible();
  const matchCode = (await phone.locator('#match').textContent()) ?? '';
  expect(matchCode).toMatch(/^\d{3} \d{3}$/);
  await shoot(phone, 'pairing-page-2-waiting', [NARROW]);

  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'found');
  await expect(main.getByText('Kitchen phone', { exact: true })).toBeVisible();
  await expect(main.getByLabel(`Matching code ${matchCode}`)).toBeVisible();
  await expect(main.getByRole('button', { name: 'Confirm' })).toBeFocused();
  await expectAccessible(page);
  await shoot(page, 'phone-3-found');

  await page.clock.install({ time: apiNow() });
  await page.clock.pauseAt(new Date(apiNow() + 1000));
  await main.getByRole('button', { name: 'Confirm' }).click();
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'paired');
  await expect(main.locator('.ph-scene .scout')).toHaveClass(/happy/);
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-blob', 'happy');
  await expect(main.getByRole('status').first()).toHaveText('Kitchen phone is paired.');
  await shoot(page, 'phone-4-paired');

  await expect(phone.getByText('This device is paired.')).toBeVisible({ timeout: 10_000 });
  expect(await phone.locator('.hop').evaluate((part) => getComputedStyle(part).animationName)).toBe(
    'hop',
  );
  await shoot(phone, 'pairing-page-3-paired', [NARROW]);
  await phoneContext.close();

  await page.clock.resume();
  const devices = main.getByRole('region', { name: 'Devices', exact: true });
  const row = devices.getByRole('listitem').filter({ hasText: 'Kitchen phone' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toHaveClass(/fresh/);
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'ready');
  await shoot(page, 'phone-5-devices', LAYOUT_SIZES);
  await expect(
    main.getByRole('region', { name: 'Recent remote activity' }).getByText('Kitchen phone paired'),
  ).toBeVisible({ timeout: 10_000 });

  await chooseDeviceAction(page, 'Kitchen phone', 'Rename');
  await devices.getByLabel('New name for Kitchen phone').fill('Hall phone');
  await devices.getByLabel('New name for Kitchen phone').press('Enter');
  await expect(devices.getByText('Hall phone')).toBeVisible();
  await chooseDeviceAction(page, 'Hall phone', 'Revoke');
  await expect(devices.getByText('No device is paired yet.')).toBeVisible();

  await main.getByRole('switch', { name: 'Remote control' }).click();
  await expect(main.getByRole('heading', { name: 'Remote control is off' })).toBeVisible();
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'setup');
});

test('denies a phone, then lets a code run out', async ({ page, browser }) => {
  const main = await openPhone(page);
  await turnOn(page);
  const code = await startPairing(page);

  const { context: phoneContext, phone } = await openPairingPage(browser, `#code=${code}`);
  await phone.getByLabel('Device name').fill('Stranger');
  await phone.getByRole('button', { name: 'Pair' }).click();

  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'found');
  await main.getByRole('button', { name: 'Deny' }).click();
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'ended');
  await expect(main.locator('.ph-scene .scout')).toHaveClass(/sad/);
  await expect(main.getByRole('status').first()).toHaveText(/You said no/);
  await expect(main.getByRole('button', { name: 'Try again' })).toBeFocused();
  await shoot(page, 'phone-5-denied');
  await expect(phone.locator('main')).toHaveAttribute('data-stage', 'ended', { timeout: 10_000 });
  await expect(phone.getByRole('button', { name: 'Try again' })).toBeFocused();
  await shoot(phone, 'pairing-page-4-denied', [NARROW]);
  await phoneContext.close();

  await startPairing(page, 'Try again');
  await page.clock.install({ time: apiNow() });
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'code');
  await page.clock.fastForward(103_000);
  await expect(main.locator('.ph-scene')).toHaveClass(/expiring/);
  await expect(main.locator('.ph-scene .scout')).toHaveClass(/alert/);
  await expect(main.getByRole('status').first()).toHaveText('This code is about to run out.');
  await expect(main.getByRole('button', { name: 'Get a new code' })).toHaveClass(/primary/);
  await shoot(page, 'phone-2-expiring');
  await page.clock.fastForward(20_000);
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'ended');
  await expect(main.getByRole('status').first()).toHaveText(/That code ran out/);
  await expect(main.getByRole('img', { name: /QR code/ })).toHaveCount(0);
  await shoot(page, 'phone-5-expired');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const moving = await main.locator('.ph-scene').evaluate((scene) =>
    scene
      .getAnimations({ subtree: true })
      .filter((item) => item.playState === 'running' && 'animationName' in item)
      .map((item) => (item as CSSAnimation).animationName),
  );
  expect(moving).toEqual([]);
});

test('keeps what the phone can do across reloads', async ({ page }) => {
  const main = await openPhone(page);
  await turnOn(page);
  const switches = main.getByRole('region', { name: 'What paired devices can do' });
  await expect(switches.getByRole('switch')).toHaveCount(12);
  await expect(switches.getByText('stay on the Mac')).toBeVisible();
  for (const name of [
    'Follow, type in and stop Terminal sessions',
    'Approve in Terminal sessions',
    'Notify when a chat needs you',
    'Notify when a turn finishes or fails',
    'Open artifacts',
  ])
    await expect(switches.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
  const reset = switches.getByRole('switch', { name: 'Reset or delete data' });
  await expect(reset).toHaveAttribute('aria-checked', 'true');
  await reset.click();
  await expect(reset).toHaveAttribute('aria-checked', 'false');

  const code = await startPairing(page);
  await pairFromPhone(code, 'Policy phone');
  await main.getByRole('button', { name: 'Confirm' }).click();

  await page.reload();
  await expect(page.getByRole('switch', { name: 'Reset or delete data' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(
    page.getByRole('switch', { name: 'Add, change and approve saved sign-ins' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    page
      .getByRole('region', { name: 'Recent remote activity' })
      .getByText('What paired devices can do was changed'),
  ).toBeVisible();
});

test('every theme passes colour and ARIA checks on the Phone page and the pairing page', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const main = await openPhone(page);
  await turnOn(page);
  const code = await startPairing(page);
  const { context, phone } = await openPairingPage(browser, `#code=${code}`);
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  await expectEveryTheme(
    [
      [page, '.ph'],
      [phone, 'main'],
    ],
    'code',
  );

  await phone.getByLabel('Device name').fill('Theme phone');
  await phone.getByRole('button', { name: 'Pair' }).click();
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'found');
  await expectEveryTheme(
    [
      [page, '.ph'],
      [phone, 'main'],
    ],
    'found',
  );

  await main.getByRole('button', { name: 'Confirm' }).click();
  const devices = main.getByRole('region', { name: 'Devices', exact: true });
  await expect(devices.getByRole('listitem').filter({ hasText: 'Theme phone' })).toBeVisible();
  await context.close();
  await expectEveryTheme([[page, '.ph']], 'devices');
});

test('the pairing page follows the saved theme or the system, groups a pasted code and keeps a refused one', async ({
  page,
  browser,
}) => {
  await openPhone(page);
  await turnOn(page);
  await startPairing(page);

  const fresh = await openPairingPage(browser, '', null);
  await expect(fresh.phone.locator('html')).toHaveAttribute('data-skin', 'light');
  await fresh.phone.emulateMedia({ colorScheme: 'dark' });
  await fresh.phone.reload();
  await expect(fresh.phone.locator('html')).toHaveAttribute('data-skin', 'graphite');
  await fresh.context.close();
  const saved = await openPairingPage(browser, '', 'apricot');
  await expect(saved.phone.locator('html')).toHaveAttribute('data-skin', 'apricot');
  await saved.context.close();

  const { context, phone } = await openPairingPage(browser);
  await expect(phone.locator('html')).toHaveAttribute('data-skin', 'light');
  const field = phone.getByLabel('Pairing code');
  await expect(field).toHaveAttribute('autocapitalize', 'characters');
  expect(await field.evaluate((input) => parseFloat(getComputedStyle(input).fontSize))).toBe(16);
  await field.fill('abcd2345efgh');
  await expect(field).toHaveValue('ABCD-2345-EFGH');
  await field.fill('abcd-2345 efgh');
  await expect(field).toHaveValue('ABCD-2345-EFGH');
  await phone.getByLabel('Device name').fill('Typo phone');
  await phone.getByRole('button', { name: 'Pair' }).click();
  await expect(phone.getByRole('status')).toHaveText(/That code is not valid/);
  await expect(phone.locator('main')).toHaveAttribute('data-stage', 'enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();
  await expect(phone.getByLabel('Device name')).toHaveValue('Typo phone');
  await shoot(phone, 'pairing-page-5-refused', [NARROW]);
  await context.close();
});

test('disconnects every device after a hold', async ({ page, browser }) => {
  const main = await openPhone(page);
  await turnOn(page);
  const code = await startPairing(page);
  const { context, phone } = await openPairingPage(browser, `#code=${code}`);
  await phone.getByLabel('Device name').fill('Hold phone');
  await phone.getByRole('button', { name: 'Pair' }).click();
  await main.getByRole('button', { name: 'Confirm' }).click();
  const devices = main.getByRole('region', { name: 'Devices', exact: true });
  await expect(devices.getByText('Hold phone')).toBeVisible({ timeout: 15_000 });
  await context.close();
  await expect(main.locator('.ph-scene')).toHaveAttribute('data-stage', 'ready');

  const hold = devices.getByRole('button', { name: 'Hold to disconnect all' });
  await hold.click();
  await expect(devices.getByText('Released early. Nothing happened.')).toBeVisible();
  await expect(devices.getByText('Hold phone')).toBeVisible();
  await hold.focus();
  await page.keyboard.down('Space');
  await expect(devices.getByText('No device is paired yet.')).toBeVisible();
  await page.keyboard.up('Space');
  await expect(hold).toHaveCount(0);
});
