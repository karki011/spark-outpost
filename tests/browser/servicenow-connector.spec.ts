import { expect, test, type Locator, type Page } from '@playwright/test';
import { SERVICENOW_PASSWORD, SERVICENOW_USER } from '../../apps/server/test/fake-servicenow.ts';
import {
  axeInEveryTheme,
  connectorCard,
  connectorHead,
  connectorStatus,
} from './connector-cards.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';
import {
  connectServiceNow,
  resetTicketFakes,
  setServiceNowFaults,
  STUB_URL,
} from './ticket-seed.ts';

const SHOTS = process.env.SERVICENOW_SHOTS ?? '';
const HOST = new URL(STUB_URL).host;

test.describe.configure({ timeout: 120_000 });

const card = (page: Page) => connectorCard(page, 'servicenow');

async function openCard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  await connectorHead(card(page)).click();
}

async function shoot(page: Page, name: string, target: Locator) {
  if (!SHOTS) return;
  await page.setViewportSize({ width: 1280, height: 1400 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => delete document.documentElement.dataset.skin);
    await animationsSettled(page);
    await target.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
}

async function types(page: Page) {
  const response = await page.request.get('/api/tickets/connections');
  const body = (await response.json()) as {
    connections: { source: string; servicenow: { types: Record<string, unknown> } | null }[];
  };
  return body.connections.find((entry) => entry.source === 'servicenow')?.servicenow?.types;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
});

test('connects with a user name and password and shows each record type', async ({ page }) => {
  await setServiceNowFaults({ denied: ['problem'] });
  await openCard(page);
  const form = card(page).getByRole('form', { name: 'Connect ServiceNow' });
  await expect(form.getByLabel('Instance')).toBeFocused();
  const signIn = form.getByRole('radiogroup', { name: 'Sign in with' });
  await expect(signIn.getByRole('radio', { name: 'Username and password' })).toBeChecked();
  await signIn.getByRole('radio', { name: 'Username and password' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(signIn.getByRole('radio', { name: 'API key' })).toBeChecked();
  await expect(form.getByLabel('API key')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(form.getByLabel('Password')).toHaveAccessibleDescription(/SSO/);

  await form.getByLabel('Instance').fill('http://example.test');
  await form.getByLabel('Username').fill(SERVICENOW_USER);
  await form.getByLabel('Password').fill(SERVICENOW_PASSWORD);
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByLabel('Instance')).toHaveAccessibleDescription(
    /Use your instance name, such as acme/,
  );
  await shoot(page, 'servicenow-form', card(page));
  await axeInEveryTheme(page, '[data-connector="servicenow"]');

  await form.getByLabel('Instance').fill(STUB_URL);
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(connectorStatus(card(page))).toHaveText(`${STUB_URL} · Jordan Lee`);
  await expect(card(page).locator('.pill-ok')).toHaveText('Connected');
  await expect(card(page)).not.toContainText(SERVICENOW_PASSWORD);
  await connectorHead(card(page)).click();

  const record = card(page).getByRole('region', { name: 'Record types' });
  await expect(record.getByRole('switch', { name: 'Incidents' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const changes = record.getByRole('switch', { name: 'Changes' });
  await expect(changes).toHaveAccessibleDescription(/Read only/);
  const problems = record.getByRole('switch', { name: 'Problems' });
  await expect(problems).toHaveAttribute('aria-checked', 'false');
  await expect(problems).toHaveAccessibleDescription('This account can’t read problems.');
  await shoot(page, 'servicenow-card', card(page));
  await axeInEveryTheme(page, '[data-connector="servicenow"]');

  await problems.click();
  await expect(card(page).getByRole('alert')).toContainText(
    "This account can't read problems, so Problems stays off.",
  );
  await changes.focus();
  await page.keyboard.press('Space');
  await expect(changes).toHaveAttribute('aria-checked', 'false');
  await expect
    .poll(async () => (await types(page))?.change)
    .toEqual({
      on: false,
      reach: 'reachable',
    });
});

test('says when the instance rejects the sign-in, on the password field', async ({ page }) => {
  await openCard(page);
  const form = card(page).getByRole('form', { name: 'Connect ServiceNow' });
  await form.getByLabel('Instance').fill(STUB_URL);
  await form.getByLabel('Username').fill(SERVICENOW_USER);
  await form.getByLabel('Password').fill('not-the-password');
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByLabel('Password')).toBeFocused();
  await expect(form.getByLabel('Password')).toHaveAccessibleDescription(
    /ServiceNow rejected this sign-in \(401\)/,
  );
  expect(await types(page)).toBeUndefined();
});

test('checks the connection, opens the instance and asks before Disconnect', async ({ page }) => {
  await connectServiceNow(page);
  await openCard(page);
  const more = card(page).getByRole('button', { name: 'Options for ServiceNow' });
  await setServiceNowFaults({ denied: ['change_request'] });
  await more.click();
  await shoot(page, 'servicenow-menu', page.locator('body'));
  await page.getByRole('menuitem', { name: 'Check connection' }).click();
  await expect(
    card(page).getByRole('status').filter({ hasText: 'Connection checked.' }),
  ).toBeVisible();
  await expect(card(page).getByRole('switch', { name: 'Changes' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  await more.click();
  const opened = page.waitForEvent('popup');
  await page.getByRole('menuitem', { name: 'Open instance' }).click();
  expect((await opened).url()).toContain(HOST);

  await more.click();
  await page.getByRole('menuitem', { name: 'Disconnect…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Disconnect ServiceNow?' });
  await expect(dialog).toContainText('Nothing changes on your instance.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await axeInEveryTheme(page, '.cx-confirm');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole('menuitem', { name: 'Disconnect…' }).click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(card(page).getByRole('form', { name: 'Connect ServiceNow' })).toBeVisible();
  expect(await types(page)).toBeUndefined();
});
