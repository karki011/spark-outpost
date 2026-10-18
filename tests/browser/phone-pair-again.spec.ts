import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator } from '@playwright/test';
import { PHONE_ADDRESS, denyWaitingPhones, resetPhone, setFakeTailscale } from './phone-support.ts';
import {
  arriveFromElsewhere,
  newPhone,
  openPhonePage,
  pairPhone,
  signedInAs,
  startPhoneNetwork,
  type PhoneNetwork,
} from './phone-tls-support.ts';

test.describe.configure({ timeout: 120_000 });

let network: PhoneNetwork;

test.beforeAll(async () => {
  network = await startPhoneNetwork();
});

test.afterAll(async () => {
  await network.close();
  setFakeTailscale(null);
});

test.beforeEach(async ({ page }) => {
  await resetPhone();
  await denyWaitingPhones(page);
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('a paired phone that arrives from another site or reopens the QR link lands in the app @packaged', async ({
  page,
}) => {
  const main = await openPhonePage(page);
  const phone = await newPhone(network);
  await pairPhone(main, phone, 'Kitchen phone');

  for (const address of [`${PHONE_ADDRESS}/`, `${PHONE_ADDRESS}/#code=AAAA-BBBB-CCCC`]) {
    const arrival = await arriveFromElsewhere(phone, address);
    await expect(arrival.page.getByRole('heading', { name: 'Pair this device' })).toHaveCount(0);
    expect(await signedInAs(arrival.page)).toBe('Kitchen phone');
    expect(arrival.documents).toEqual(['', '?spark_entry=1', '']);
    expect(arrival.cookieSent).toEqual([false, true, true]);
    await arrival.page.reload();
    expect(await signedInAs(arrival.page)).toBe('Kitchen phone');
    await arrival.page.close();
  }

  const typed = await phone.newPage();
  await typed.goto(`${PHONE_ADDRESS}/`);
  await expect(typed.getByRole('heading', { name: 'Pair this device' })).toHaveCount(0);
  expect(await signedInAs(typed)).toBe('Kitchen phone');

  const stranger = await newPhone(network);
  const unpaired = await arriveFromElsewhere(stranger, `${PHONE_ADDRESS}/chats`);
  await expect(unpaired.page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  expect(unpaired.documents).toEqual(['', '?spark_entry=1']);
  expect(new URL(unpaired.page.url()).search).toBe('');
  expect(await signedInAs(unpaired.page)).toBeNull();

  const activity = main.getByRole('region', { name: 'Recent remote activity' });
  await expect(activity.getByText('A device with no sign-in opened the pairing page')).toBeVisible({
    timeout: 15_000,
  });
  await phone.close();
  await stranger.close();
});

async function expectActivityLine(main: Locator, text: string) {
  const activity = main.getByRole('region', { name: 'Recent remote activity' });
  const line = activity.getByText(text);
  const more = activity.getByRole('button', { name: 'Show more' });
  while (!(await line.isVisible()) && (await more.isVisible())) await more.click();
  await expect(line).toBeVisible();
}

test('pairing a phone again does not pile up devices', async ({ page }) => {
  const main = await openPhonePage(page);
  const devices = main.getByRole('region', { name: 'Devices', exact: true });
  const rows = devices.locator('.ph-devices').first().getByRole('listitem');
  const phone = await newPhone(network);
  await pairPhone(main, phone, 'Kitchen phone');
  await expect(rows).toHaveCount(1, { timeout: 15_000 });
  await expect(devices.getByRole('button', { name: /removed$/ })).toHaveCount(0);

  await devices.getByRole('button', { name: 'Revoke Kitchen phone' }).click();
  await expect(devices.getByText('No device is paired yet.')).toBeVisible();
  await expect(devices.getByRole('button', { name: '1 removed' })).toBeVisible();

  await pairPhone(main, phone, 'Kitchen phone');
  await expect(rows).toHaveCount(1, { timeout: 15_000 });
  await expect(rows.first()).toHaveClass(/fresh/);
  const removed = devices.getByRole('button', { name: '1 removed' });
  await expect(removed).toHaveAttribute('aria-expanded', 'false');
  await removed.focus();
  await page.keyboard.press('Enter');
  await expect(removed).toHaveAttribute('aria-expanded', 'true');
  await expect(
    devices.getByRole('list', { name: 'Removed devices' }).getByRole('listitem'),
  ).toHaveText(/Kitchen phone.*Replaced when it paired again.*Cannot connect/);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.ph')
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press('Enter');

  await phone.close();
  const second = await newPhone(network);
  await pairPhone(main, second, 'kitchen phone');
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  await expect(rows.nth(0)).toContainText('Not seen since');
  await expect(rows.nth(1)).toContainText('Last seen');
  await expect(rows.nth(1)).toHaveClass(/fresh/);
  await expect(devices.getByRole('button', { name: 'Revoke kitchen phone' })).toBeVisible();
  await devices.getByRole('button', { name: 'Remove old entry Kitchen phone' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('kitchen phone');
  await expect(devices.getByRole('button', { name: '2 removed' })).toBeVisible();
  await expectActivityLine(main, 'Kitchen phone asked to pair again (it was removed on this Mac)');
  await second.close();
});
