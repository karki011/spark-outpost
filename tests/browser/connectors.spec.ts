import { expect, test, type Page } from '@playwright/test';
import { JIRA_EMAIL, JIRA_TOKEN } from '../../apps/server/test/fake-jira.ts';
import { resetTestDatabase } from './database.ts';
import { connectorCard, connectorHead, connectorStatus } from './connector-cards.ts';
import { connectTickets, resetTicketFakes, STUB_URL } from './ticket-seed.ts';

const MIN_CHECK_MS = 1200;

async function openConnectors(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
}

async function connections(page: Page) {
  const response = await page.request.get('/api/tickets/connections');
  return ((await response.json()) as { connections: { source: string; moveOnMerge: boolean }[] })
    .connections;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
});

test('Settings connects Jira after a visible check and collapses into a summary', async ({
  page,
}) => {
  await openConnectors(page);
  const cards = page.locator('.cgrid > li');
  await expect(cards.nth(1)).toHaveAttribute('data-connector', 'jira');
  await expect(cards.nth(3)).toHaveAttribute('data-connector', 'slack');
  const jira = connectorCard(page, 'jira');
  await expect(connectorHead(jira)).toHaveAttribute('aria-expanded', 'false');
  await expect(connectorHead(connectorCard(page, 'linear'))).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  await connectorHead(jira).click();
  await expect(connectorHead(jira)).toHaveAttribute('aria-expanded', 'true');
  await expect(connectorHead(connectorCard(page, 'linear'))).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const form = jira.getByRole('form', { name: 'Connect Jira' });
  await expect(form.getByLabel('Site URL')).toBeFocused();
  const tokenLink = form.getByRole('link', { name: /Create an API token/ });
  await expect(tokenLink).toHaveAttribute(
    'href',
    'https://id.atlassian.com/manage-profile/security/api-tokens',
  );
  await expect(tokenLink).toHaveAttribute('target', '_blank');
  await expect(form).toContainText('Use the email you sign in to Atlassian with.');

  await form.getByLabel('Site URL').fill(`  ${STUB_URL}/  `);
  await form.getByLabel('Email').fill(JIRA_EMAIL);
  await expect(form.getByLabel('Site URL')).toHaveValue(STUB_URL);
  const token = form.getByLabel('API token');
  await token.fill(JIRA_TOKEN);
  await expect(token).toHaveAttribute('type', 'password');
  await form.getByRole('button', { name: 'Show' }).click();
  await expect(token).toHaveAttribute('type', 'text');
  await form.getByRole('button', { name: 'Hide' }).click();

  const started = Date.now();
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByRole('status')).toHaveText('Checking with Jira…');
  await expect(form.locator('.cb[data-mood="checking"]')).toBeVisible();
  await expect(form.getByRole('status')).toHaveText('Connected!');
  expect(Date.now() - started).toBeGreaterThanOrEqual(MIN_CHECK_MS);
  await expect(form.locator('.cb[data-mood="happy"]')).toBeVisible();

  await expect(form).toBeHidden();
  await expect(connectorStatus(jira)).toHaveText(`Connected to ${STUB_URL} as ${JIRA_EMAIL}`);
  await expect(jira.locator('.pill-ok')).toHaveText('Connected');
  await expect(jira).not.toContainText(JIRA_TOKEN);
});

test('a rejected Jira token shows a sad check and the error next to the token', async ({
  page,
}) => {
  await openConnectors(page);
  const jira = connectorCard(page, 'jira');
  await connectorHead(jira).click();
  const form = jira.getByRole('form', { name: 'Connect Jira' });
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByRole('alert')).toContainText('Use your Jira site address');
  await expect(form.getByLabel('Site URL')).toBeFocused();
  await expect(form.locator('.cb')).toHaveCount(0);

  await form.getByLabel('Site URL').fill(STUB_URL);
  await form.getByLabel('Email').fill(JIRA_EMAIL);
  await form.getByLabel('API token').fill('jira_wrong_token_0123456789');
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.locator('.cb[data-mood="sad"]')).toBeVisible();
  const token = form.getByLabel('API token');
  await expect(token).toHaveAttribute('aria-invalid', 'true');
  await expect(token).toBeFocused();
  await expect(form.getByRole('alert')).toContainText('Jira rejected this key (401)');
  await expect(token).toHaveAccessibleDescription(/Jira rejected this key/);

  await token.fill(JIRA_TOKEN);
  await expect(form.locator('.cb')).toHaveCount(0);
  await expect(form.getByRole('alert')).toHaveCount(0);
  expect(await connections(page)).toEqual([]);
});

test('Disconnect waits for Undo, and the ticket update switches save @packaged', async ({
  page,
}) => {
  await connectTickets(page, ['jira']);
  await openConnectors(page);
  const jira = connectorCard(page, 'jira');
  await expect(connectorStatus(jira)).toHaveText(`Connected to ${STUB_URL} as ${JIRA_EMAIL}`);

  await connectorHead(jira).click();
  const merge = jira.getByRole('switch', { name: 'Move tickets to Done when the PR merges' });
  const before = (await connections(page))[0]!.moveOnMerge;
  await merge.click();
  await expect(merge).toBeChecked({ checked: !before });
  await expect.poll(async () => (await connections(page))[0]!.moveOnMerge).toBe(!before);

  await jira.getByRole('button', { name: 'Disconnect' }).click();
  const grace = page.locator('.toast.grace');
  await expect(grace).toContainText('Disconnecting Jira…');
  await expect(connectorStatus(jira)).toHaveText('Disconnecting Jira…');
  await grace.getByRole('button', { name: 'Undo' }).click();
  await expect(grace).toBeHidden();
  await expect(connectorStatus(jira)).toHaveText(`Connected to ${STUB_URL} as ${JIRA_EMAIL}`);
  expect(await connections(page)).toHaveLength(1);

  await jira.getByRole('button', { name: 'Disconnect' }).click();
  await expect(jira.getByRole('form', { name: 'Connect Jira' })).toBeVisible({ timeout: 10_000 });
  await expect(jira.locator('.pill-ok')).toHaveCount(0);
  expect(await connections(page)).toEqual([]);
});
