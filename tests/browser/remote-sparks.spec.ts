import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { RemoteSparkList } from '../../packages/contracts/src/remote-sparks.ts';
import { openTestDb } from './database.ts';
import { asPairedPhone } from './paired-phone.ts';
import {
  PHONE_ADDRESS,
  asPhone,
  denyWaitingPhones,
  expand,
  openPhone,
  resetPhone,
  setFakeTailscale,
  startPairing,
  turnOn,
  WIDE,
} from './phone-support.ts';

const STUDIO = 'studio.tail1234.ts.net';

test.describe.configure({ timeout: 120_000 });

async function forgetSavedSparks(): Promise<void> {
  const db = openTestDb();
  try {
    await db.query('TRUNCATE remote_sparks');
  } finally {
    await db.end();
  }
}

async function asMacApp(page: Page): Promise<void> {
  await page.route('**/api/remote-sparks', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const list = (await response.json()) as RemoteSparkList;
    await route.fulfill({ response, json: { ...list, available: true } });
  });
}

test.beforeEach(async ({ page }) => {
  await resetPhone();
  await forgetSavedSparks();
  await denyWaitingPhones(page);
  await page.setViewportSize(WIDE);
});

test.afterAll(() => {
  setFakeTailscale(null);
});

test('another Mac’s Spark is added, listed, renamed and removed', async ({ page }) => {
  await asMacApp(page);
  const main = await openPhone(page);
  await expand(main, 'Other Sparks');
  const card = main.getByRole('region', { name: 'Other Sparks' });
  await expect(card.getByText('No other Spark is saved yet.')).toBeVisible();

  const add = card.getByRole('button', { name: 'Add a Spark' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Add a Spark' });
  const address = dialog.getByLabel('Address or pairing link');
  await expect(address).toBeFocused();

  await address.fill(`http://${STUDIO}`);
  await expect(dialog.getByText('The address must start with https://.')).toBeVisible();
  await address.fill('https://studio.example.com');
  await expect(dialog.getByText(/the address must end in \.ts\.net/)).toBeVisible();

  await address.fill(`https://${STUDIO}/#code=ABCD-EFGH-JKLM`);
  await expect(dialog.getByText(`Opens ${STUDIO} with its pairing code filled in.`)).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.rs-dialog')
    .analyze();
  expect(axe.violations).toEqual([]);
  await dialog.getByLabel('Name').fill('Studio Mac');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();

  const row = card.getByRole('listitem').filter({ hasText: 'Studio Mac' });
  await expect(row.getByText('Not paired yet')).toBeVisible();
  await expect(row.getByText(STUDIO)).toBeVisible();
  await expect(row.getByRole('button', { name: 'Open Studio Mac' })).toBeVisible();

  await add.click();
  await address.fill(STUDIO);
  await dialog.getByLabel('Name').fill('Studio again');
  await dialog.getByRole('button', { name: 'Add a Spark' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('That Mac is already in your list.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();

  await row.getByRole('button', { name: 'Actions for Studio Mac' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('New name for Studio Mac').fill('Garage Mac');
  await page.keyboard.press('Enter');
  const renamed = card.getByRole('listitem').filter({ hasText: 'Garage Mac' });
  await expect(renamed).toBeVisible();

  await renamed.getByRole('button', { name: 'Actions for Garage Mac' }).click();
  await page.getByRole('menuitem', { name: 'Remove…' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Remove Garage Mac?' });
  await expect(confirm.getByText(/Also revoke this Mac on Garage Mac/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(card.getByText('No other Spark is saved yet.')).toBeVisible();
});

test('outside the Mac app the card only says where other Sparks open', async ({ page }) => {
  const main = await openPhone(page);
  await expand(main, 'Other Sparks');
  const card = main.getByRole('region', { name: 'Other Sparks' });
  await expect(card.getByText('Other Sparks open from the Mac app.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Add a Spark' })).toHaveCount(0);
});

test('a paired device never sees the Other Sparks card', async ({ page }) => {
  await asMacApp(page);
  await asPairedPhone(page);
  const main = await openPhone(page);
  await expect(main.getByRole('heading', { name: 'Remote control', level: 1 })).toBeVisible();
  await expect(main.getByText('Other Sparks')).toHaveCount(0);
});

test('the host names a Spark that pairs and copies the pairing link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const main = await openPhone(page);
  await turnOn(page);
  const code = await startPairing(page);

  await main.getByRole('button', { name: 'Copy pairing link' }).click();
  await expect(main.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${PHONE_ADDRESS}/#code=${code}`,
  );

  const submitted = await asPhone(
    'POST',
    '/api/remote/pair',
    JSON.stringify({ code, deviceName: 'Laptop Mac', kind: 'spark' }),
  );
  const { claim } = JSON.parse(submitted.body) as { claim: string };
  const found = main.locator('.ph-found');
  await expect(found.getByText('Laptop Mac')).toBeVisible();
  await expect(found.getByText('Spark Outpost')).toBeVisible();
  await found.getByRole('button', { name: 'Confirm' }).click();
  await asPhone('POST', '/api/remote/pair/claim', JSON.stringify({ claim }));

  const device = main.getByRole('listitem').filter({ hasText: 'Laptop Mac' });
  await expect(device.getByText('Spark Outpost')).toBeVisible();
});
