import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  addAuthenticator,
  copyPasskey,
  passkeysIn,
  savePasskeyByScript,
  signInOptionsStatus,
} from './phone-passkey-support.ts';
import { PHONE_ADDRESS, denyWaitingPhones, resetPhone, setFakeTailscale } from './phone-support.ts';
import {
  newPhone,
  openPhonePage,
  pairPhone,
  signedInAs,
  startPhoneNetwork,
  type PhoneNetwork,
} from './phone-tls-support.ts';
import { PACKAGED } from './stub-config.ts';

test.describe.configure({ timeout: 120_000 });

const SIGN_IN = 'Sign in with a passkey';
const PAIR_HEADING = 'Pair this device';
const SAVE = 'Save a passkey for this device';

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

async function openPairingPage(phone: Page): Promise<void> {
  await phone.goto(`${PHONE_ADDRESS}/`);
  await expect(phone.getByRole('heading', { name: PAIR_HEADING })).toBeVisible();
}

test('a paired phone signs in with its passkey in a browser that has no cookie', async ({
  page,
}) => {
  const main = await openPhonePage(page);
  const devices = main.getByRole('region', { name: 'Devices' });
  const rows = devices.locator('.ph-devices').first().getByRole('listitem');
  const firstBrowser = await newPhone(network);
  const first = await pairPhone(main, firstBrowser, 'Kitchen phone');
  const firstAuthenticator = await addAuthenticator(firstBrowser, first);
  expect(await savePasskeyByScript(first)).toBe(201);
  await expect(rows.first()).toContainText(/1 passkey · added/, { timeout: 15_000 });
  const [passkey] = await passkeysIn(firstAuthenticator);
  expect(passkey).toMatchObject({ isResidentCredential: true, rpId: new URL(PHONE_ADDRESS).host });

  const secondBrowser = await newPhone(network);
  const second = await secondBrowser.newPage();
  await copyPasskey(await addAuthenticator(secondBrowser, second), passkey!);
  await openPairingPage(second);
  const button = second.getByRole('button', { name: SIGN_IN });
  await expect(button).toBeVisible();
  await expect(second.getByText('Paired this device before?')).toBeVisible();
  const axe = await new AxeBuilder({ page: second })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  expect(await second.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
  await button.focus();
  await second.keyboard.press('Enter');
  await expect(second.getByRole('heading', { name: PAIR_HEADING })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect.poll(() => signedInAs(second)).toBe('Kitchen phone');
  expect(await signedInAs(first)).toBe('Kitchen phone');
  await second.reload();
  expect(await signedInAs(second)).toBe('Kitchen phone');
  await expect(rows).toHaveCount(1);
  const activity = main.getByRole('region', { name: 'Recent remote activity' });
  await expect(activity.getByText('Kitchen phone signed in with a passkey')).toBeVisible({
    timeout: 15_000,
  });
  await expect(activity.getByText('Kitchen phone saved a passkey')).toBeVisible();

  const thirdBrowser = await newPhone(network);
  const third = await thirdBrowser.newPage();
  await copyPasskey(await addAuthenticator(thirdBrowser, third), passkey!);
  await main.getByRole('switch', { name: 'Allow passkey sign-in' }).click();
  await expect(main.getByRole('switch', { name: 'Allow passkey sign-in' })).not.toBeChecked();
  await openPairingPage(third);
  await expect(third.getByRole('button', { name: SIGN_IN })).toHaveCount(0);
  await expect(third.getByRole('button', { name: 'Pair' })).toBeVisible();
  expect(await signInOptionsStatus(third)).toBe(401);

  await main.getByRole('switch', { name: 'Allow passkey sign-in' }).click();
  await expect(main.getByRole('switch', { name: 'Allow passkey sign-in' })).toBeChecked();
  await devices.getByRole('button', { name: 'Revoke Kitchen phone' }).click();
  await expect(devices.getByText('No device is paired yet.')).toBeVisible();
  await openPairingPage(third);
  await third.getByRole('button', { name: SIGN_IN }).click();
  await expect(third.getByRole('status')).toHaveText(
    'That passkey did not work here. Pair with a code from your Mac.',
  );
  await expect(third.getByRole('heading', { name: PAIR_HEADING })).toBeVisible();
  await expect(third.getByRole('button', { name: SIGN_IN })).toBeFocused();
  expect(await signedInAs(third)).toBeNull();
  expect(await signedInAs(second)).toBeNull();

  await firstBrowser.close();
  await secondBrowser.close();
  await thirdBrowser.close();
});

test('the pairing page says so when no passkey is used, and keeps pairing by code', async ({
  page,
}) => {
  await openPhonePage(page);
  const browser = await newPhone(network);
  const phone = await browser.newPage();
  await addAuthenticator(browser, phone);
  await phone.emulateMedia({ colorScheme: 'dark' });
  await openPairingPage(phone);
  await phone.getByRole('button', { name: SIGN_IN }).click();
  await expect(phone.getByRole('status')).toHaveText(
    'No passkey was used. Try again, or pair with a code from your Mac.',
    { timeout: 15_000 },
  );
  await expect(phone.getByRole('button', { name: SIGN_IN })).toBeEnabled();
  await expect(phone.getByLabel('Pairing code')).toBeVisible();
  const axe = await new AxeBuilder({ page: phone })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await browser.close();
});

test('the phone app offers a passkey once and the Mac can remove it @packaged', async ({
  page,
}) => {
  test.skip(!PACKAGED, 'The phone only gets the web app from a packaged server.');
  const main = await openPhonePage(page);
  const devices = main.getByRole('region', { name: 'Devices' });
  const browser = await newPhone(network);
  const phone = await pairPhone(main, browser, 'Kitchen phone');
  await addAuthenticator(browser, phone);

  const offer = phone.getByRole('complementary', { name: 'Passkey for this device' });
  await expect(offer).toContainText(
    'Lets this device sign in again in another browser without going back to your Mac.',
    { timeout: 20_000 },
  );
  await offer.getByRole('button', { name: SAVE }).click();
  await expect(offer).toContainText('Passkey saved.');
  await expect(devices).toContainText(/1 passkey · added/, { timeout: 15_000 });
  await offer.getByRole('button', { name: 'Dismiss' }).click();
  await phone.reload();
  await expect(phone.getByRole('navigation').first()).toBeVisible();
  await expect(phone.getByRole('button', { name: SAVE })).toHaveCount(0);

  await devices.getByRole('button', { name: 'Remove passkeys for Kitchen phone' }).click();
  await expect(devices.getByText(/1 passkey/)).toHaveCount(0);
  await expect(devices.getByRole('button', { name: 'Revoke Kitchen phone' })).toBeVisible();
  expect(await signedInAs(phone)).toBe('Kitchen phone');
  await browser.close();
});
