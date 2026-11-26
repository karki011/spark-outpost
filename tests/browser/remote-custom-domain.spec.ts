import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { RemoteSparkList } from '../../packages/contracts/src/remote-sparks.ts';
import { openTestDb } from './database.ts';
import {
  denyWaitingPhones,
  expand,
  openPhone,
  resetPhone,
  setFakeTailscale,
  startPairing,
  WIDE,
} from './phone-support.ts';

const DOMAIN = 'spark.example.com';
const ON_NOTE = "Reached at your custom domain. Spark can't check who can open it.";

test.describe.configure({ timeout: 120_000 });

async function forgetSavedSparks(): Promise<void> {
  const db = openTestDb();
  try {
    await db.query('TRUNCATE remote_sparks, local_spark');
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

test('a Spark at a custom domain needs the trust tick and carries its tag', async ({ page }) => {
  await asMacApp(page);
  const main = await openPhone(page);
  await expand(main, 'Other Sparks');
  const card = main.getByRole('region', { name: 'Other Sparks' });
  await card.getByRole('button', { name: 'Add a Spark' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a Spark' });
  const address = dialog.getByLabel('Address or pairing link');
  const add = dialog.getByRole('button', { name: 'Add a Spark' });
  const trust = dialog.getByLabel('I trust this address');

  await address.fill('studio.tail1234.ts.net');
  await expect(trust).toHaveCount(0);
  await expect(add).toBeEnabled();

  await address.fill(`https://${DOMAIN}`);
  await expect(dialog.getByText("This isn't a Tailscale address.")).toBeVisible();
  await expect(add).toBeDisabled();
  await dialog.getByLabel('Name').fill('Cabin');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.rs-dialog')
    .analyze();
  expect(axe.violations).toEqual([]);
  await trust.check();
  await add.click();
  await expect(dialog).toBeHidden();

  const row = card.getByRole('listitem').filter({ hasText: 'Cabin' });
  await expect(row.getByText('Custom domain')).toBeVisible();
  await expect(row.getByText(`${DOMAIN} · Not checked by Spark`)).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^This Mac/ })
    .click();
  const item = page.getByRole('menu', { name: 'Sparks' }).getByRole('menuitem', { name: /Cabin/ });
  await expect(item.getByText('Custom domain')).toBeVisible();
});

test('this computer is reached at a custom domain, then turned off', async ({ page }) => {
  const main = await openPhone(page);
  const choice = main.getByRole('radiogroup', { name: 'How devices reach this computer' });
  await expect(choice.getByRole('radio', { name: 'Tailscale' })).toBeChecked();
  await expect(main.getByRole('list', { name: 'Set up remote control' })).toBeVisible();

  await choice.getByRole('radio', { name: 'Custom domain' }).click();
  const domain = main.getByRole('textbox', { name: 'Domain' });
  const turnOn = main.getByRole('button', { name: 'Turn on' });
  await expect(turnOn).toBeDisabled();
  await expect(main.getByRole('group', { name: 'Forward requests to' }).locator('code')).toHaveText(
    /^http:\/\/127\.0\.0\.1:\d+$/,
  );
  await expect(main.getByText("Spark can't check that this domain is private.")).toBeVisible();

  await domain.fill('mac.tail1234.ts.net');
  await expect(
    main.getByText('That is a Tailscale address. Choose Tailscale to use it.'),
  ).toBeVisible();
  await domain.fill(`https://${DOMAIN}`);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.ph-area-setup')
    .analyze();
  expect(axe.violations).toEqual([]);
  await main
    .getByRole('checkbox', { name: 'I run this domain and control who can reach it' })
    .check();
  await expect(turnOn).toBeEnabled();
  await turnOn.click();

  await expect(main.getByRole('heading', { name: /^Remote control is on/ })).toBeVisible();
  await expect(main.getByText(ON_NOTE)).toBeVisible();
  await expect(main.getByText(/Only devices on your own tailnet/)).toHaveCount(0);
  await expect(main.locator('.ph-address code')).toHaveText(`https://${DOMAIN}`);
  await expect(choice.getByRole('radio', { name: 'Custom domain' })).toBeChecked();

  const code = await startPairing(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await main.getByRole('button', { name: 'Copy pairing link' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `https://${DOMAIN}/#code=${code}`,
  );

  await page.reload();
  await expect(main.getByText(ON_NOTE)).toBeVisible();
  await main.getByRole('button', { name: 'Turn off' }).click();
  await expect(domain).toBeVisible();
  await expect(main.getByText(ON_NOTE)).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Turn on' })).toBeDisabled();
});
