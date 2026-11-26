import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  REMOTE_SPARK_ICON_SIZE,
  type RemoteSpark,
  type RemoteSparkList,
} from '../../packages/contracts/src/remote-sparks.ts';
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
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe.configure({ timeout: 120_000 });

async function forgetSavedSparks(): Promise<void> {
  const db = openTestDb();
  try {
    await db.query('TRUNCATE remote_sparks, local_spark');
  } finally {
    await db.end();
  }
}

type Seen = Pick<RemoteSpark, 'status' | 'needsYou'>;

async function asMacApp(page: Page, seen: Record<string, Seen> = {}): Promise<void> {
  await page.route('**/api/remote-sparks', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const list = (await response.json()) as RemoteSparkList;
    const sparks = list.sparks.map((spark) => ({ ...spark, ...seen[spark.name] }));
    await route.fulfill({ response, json: { ...list, sparks, available: true } });
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
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^This Mac/ }),
  ).toHaveCount(0);

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
  await expect(
    confirm.getByText(
      'Removing deletes this Mac’s saved sign-in for Garage Mac. Spark also asks Garage Mac to end this Mac’s access. If that Mac is asleep or offline, revoke this Mac there.',
    ),
  ).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(card.getByText('No other Spark is saved yet.')).toBeVisible();
});

test('saved Sparks show their status, what waits there, and open from their row', async ({
  page,
}) => {
  await asMacApp(page, {
    'Studio Mac': { status: 'online', needsYou: 2 },
    'Attic Mac': { status: 'offline', needsYou: 0 },
  });
  const opened: string[] = [];
  await page.route('**/api/remote-sparks/*/open', async (route) => {
    opened.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: {} });
  });
  const main = await openPhone(page);
  await expand(main, 'Other Sparks');
  const card = main.getByRole('region', { name: 'Other Sparks' });
  const dialog = page.getByRole('dialog', { name: 'Add a Spark' });
  for (const [name, host] of [
    ['Studio Mac', STUDIO],
    ['Attic Mac', 'attic.tail1234.ts.net'],
  ] as const) {
    await card.getByRole('button', { name: 'Add a Spark' }).click();
    await dialog.getByLabel('Address or pairing link').fill(host);
    await dialog.getByLabel('Name').fill(name);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
  }

  const studio = card.getByRole('listitem').filter({ hasText: 'Studio Mac' });
  await expect(studio.getByText('Online')).toBeVisible();
  await expect(studio.getByText('2 waiting')).toBeVisible();
  const attic = card.getByRole('listitem').filter({ hasText: 'Attic Mac' });
  await expect(attic.getByText('Offline')).toBeVisible();
  await expect(attic.getByText(/waiting$/)).toHaveCount(0);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.rs-list')
    .analyze();
  expect(axe.violations).toEqual([]);

  await studio.getByRole('button', { name: 'Open Studio Mac' }).click();
  await expect.poll(() => opened).toHaveLength(1);
  expect(opened[0]).toMatch(/^\/api\/remote-sparks\/[0-9a-f-]{36}\/open$/);

  const rail = page.getByRole('navigation', { name: 'Main' });
  const switcher = rail.getByRole('button', {
    name: 'This Mac. 2 requests waiting on other Sparks',
  });
  await expect(rail.getByRole('button').nth(1)).toHaveAccessibleName(/^This Mac/);
  await switcher.click();
  const menu = page.getByRole('menu', { name: 'Sparks' });
  await expect(menu.getByRole('menuitemradio', { name: /This Mac/ })).toBeChecked();
  await expect(menu.getByRole('menuitem', { name: /Studio Mac/ })).toContainText('Online');
  await expect(menu.getByRole('menuitem', { name: /Studio Mac/ })).toContainText('2 waiting');
  await expect(menu.getByRole('menuitem', { name: /Attic Mac/ })).toContainText('Offline');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(switcher).toBeFocused();

  await switcher.click();
  await menu.getByRole('menuitem', { name: /Attic Mac/ }).click();
  await expect.poll(() => opened).toHaveLength(2);
  await expect(menu).toBeHidden();
});

test('this Mac and a saved Spark get a name and an icon of their own', async ({ page }) => {
  await asMacApp(page);
  const main = await openPhone(page);
  await expand(main, 'Other Sparks');
  const card = main.getByRole('region', { name: 'Other Sparks' });
  const own = card.getByRole('listitem').first();
  await expect(own.getByText('This Mac', { exact: true })).toBeVisible();
  await expect(own.getByText(/sees this name when this one pairs/)).toBeVisible();
  await expect(own.getByRole('button', { name: /^Open/ })).toHaveCount(0);

  await card.getByRole('button', { name: 'Add a Spark' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a Spark' });
  await dialog.getByLabel('Address or pairing link').fill(STUDIO);
  await dialog.getByLabel('Name').fill('Studio Mac');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  const rail = page.getByRole('navigation', { name: 'Main' });
  await expect(rail.getByRole('button', { name: 'This Mac', exact: true })).toBeVisible();

  const ownActions = own.getByRole('button', { name: 'Actions for This Mac' });
  await ownActions.click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('New name for This Mac').fill('Office');
  await page.keyboard.press('Enter');
  await expect(own.getByText('Office', { exact: true })).toBeVisible();
  await expect(ownActions).toBeFocused();
  const switcher = rail.getByRole('button', { name: 'Office', exact: true });
  await expect(switcher).toBeVisible();

  const studio = card.getByRole('listitem').filter({ hasText: 'Studio Mac' });
  await expect(studio.locator('img')).toHaveCount(0);
  await studio.locator('input[type="file"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(ONE_PIXEL_PNG, 'base64'),
  });
  const image = studio.locator('img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(REMOTE_SPARK_ICON_SIZE);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.rs-list')
    .analyze();
  expect(axe.violations).toEqual([]);

  await switcher.click();
  const menu = page.getByRole('menu', { name: 'Sparks' });
  await expect(menu.getByRole('menuitemradio', { name: 'Office' })).toBeChecked();
  await expect(menu.getByRole('menuitem', { name: /Studio Mac/ }).locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await studio.getByRole('button', { name: 'Actions for Studio Mac' }).click();
  await page.getByRole('menuitem', { name: 'Remove icon' }).click();
  await expect(studio.locator('img')).toHaveCount(0);
  await studio.getByRole('button', { name: 'Actions for Studio Mac' }).click();
  await expect(page.getByRole('menuitem', { name: 'Remove icon' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await ownActions.click();
  await page.getByRole('menuitem', { name: 'Use computer name' }).click();
  await expect(rail.getByRole('button', { name: 'This Mac', exact: true })).toBeVisible();
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
