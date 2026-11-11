import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  NARROW,
  denyWaitingPhones,
  openPairingPage,
  openPhone,
  resetPhone,
  setFakeTailscale,
  startPairing,
  turnOn,
  WIDE,
} from './phone-support.ts';

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

async function pairDevice(page: Page, browser: Browser, name: string): Promise<void> {
  const code = await startPairing(page, /Pair a device|Get a new code|Pair another/);
  const { context, phone } = await openPairingPage(browser, `#code=${code}`);
  await phone.getByLabel('Device name').fill(name);
  await phone.getByRole('button', { name: 'Pair' }).click();
  await page.getByRole('main').getByRole('button', { name: 'Confirm' }).click();
  await expect(phone.getByText('This device is paired.')).toBeVisible({ timeout: 10_000 });
  await context.close();
}

test('guides the first steps when Tailscale is not installed', async ({ page }) => {
  let status = 'not_installed';
  await page.route('**/api/remote/tailscale', (route) =>
    route.fulfill({ json: { status, hostname: null, address: null, message: null } }),
  );
  const main = await openPhone(page);
  await expect(main.getByRole('heading', { name: 'Tailscale is not installed' })).toBeVisible();
  const steps = main.getByRole('list', { name: 'Set up remote control' });
  await expect(steps.getByRole('listitem')).toHaveCount(3);
  await expect(steps.getByRole('listitem').nth(0)).toContainText('Step 1 · Needs you');
  await expect(steps.getByRole('listitem').nth(1)).toContainText('Step 2 · Next');
  await expect(steps.getByRole('listitem').nth(2)).toContainText('Step 3 · Later');
  const download = steps.getByRole('link', { name: 'Download Tailscale' });
  await expect(download).toHaveAttribute('href', 'https://tailscale.com/download');
  await expect(download).toHaveAttribute('target', '_blank');
  await expect(steps.getByRole('button', { name: 'Check again' })).toBeVisible();
  await expect(steps.getByText('Installed but not connected?')).toBeVisible();
  await expect(main.getByRole('switch', { name: 'Remote control' })).toHaveCount(0);

  await page.setViewportSize(NARROW);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    NARROW.width,
  );
  const tops = await steps
    .getByRole('listitem')
    .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(3);

  status = 'off';
  await steps.getByRole('button', { name: 'Check again' }).click();
  await expect(main.getByRole('heading', { name: 'Remote control is off' })).toBeVisible();
  await expect(steps.getByRole('listitem').nth(0)).toContainText('Step 1 · Done');
  await expect(steps.getByRole('listitem').nth(2)).toContainText('Step 3 · Needs you');
  await expect(steps.getByRole('switch', { name: 'Remote control' })).toBeVisible();
});

test('groups the switches by risk and keeps each count current', async ({ page }) => {
  const main = await openPhone(page);
  await turnOn(page);
  const region = main.getByRole('region', { name: 'What paired devices can do' });
  await expect(region.getByText('Read chats, send messages, answer ordinary cards')).toBeVisible();
  await expect(region.getByText('stay on the Mac')).toBeVisible();
  const everyday = region.getByRole('group', { name: 'Everyday' });
  const setup = region.getByRole('group', { name: 'Set up work' });
  const risky = region.getByRole('group', { name: 'High risk' });
  await expect(everyday.getByRole('switch')).toHaveCount(4);
  await expect(setup.getByRole('switch')).toHaveCount(4);
  await expect(risky.getByRole('switch')).toHaveCount(4);
  await expect(everyday).toContainText('All off');
  await expect(setup).toContainText('All on');
  await expect(risky).toContainText('3 of 4 on');

  const notify = everyday.getByRole('switch', { name: 'Notify when a chat needs you' });
  await notify.click();
  await expect(notify).toHaveAttribute('aria-checked', 'true');
  await expect(everyday).toContainText('1 of 4 on');
  await expect(region.getByText('Sender contact')).toBeVisible();

  const reset = risky.getByRole('switch', { name: 'Reset or delete data' });
  await reset.click();
  await expect(risky).toContainText('2 of 4 on');
  await reset.click();
  await expect(risky).toContainText('3 of 4 on');
  await notify.click();
  await expect(everyday).toContainText('All off');
  await expect(region.getByText('Sender contact')).toHaveCount(0);
});

test('a device row menu renames and removes by keyboard', async ({ page, browser }) => {
  const main = await openPhone(page);
  await turnOn(page);
  await pairDevice(page, browser, 'Kitchen phone');
  const devices = main.getByRole('region', { name: 'Devices', exact: true });
  await expect(devices.getByRole('listitem').filter({ hasText: 'Kitchen phone' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(main.getByRole('heading', { name: /1 device can reach this Mac/ })).toBeVisible();

  const actions = devices.getByRole('button', { name: 'Actions for Kitchen phone' });
  await actions.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Actions for Kitchen phone' });
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(actions).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const field = devices.getByLabel('New name for Kitchen phone');
  await expect(field).toBeFocused();
  await field.fill('Hall phone');
  await page.keyboard.press('Enter');
  await expect(devices.getByText('Hall phone', { exact: true })).toBeVisible();
  const renamed = devices.getByRole('button', { name: 'Actions for Hall phone' });
  await expect(renamed).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Send a test notification' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(devices.getByRole('status')).toHaveText(
    'Turn on Notify when a chat needs you, then try again.',
  );
  await expect(renamed).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Revoke' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(devices.getByText('No device is paired yet.')).toBeVisible();
  await expect(main.getByRole('heading', { name: /No device is paired yet/ })).toBeVisible();
});
