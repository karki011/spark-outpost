import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const ECHO = path.resolve('apps/server/test/echo-mcp-server.mjs');
const TOKEN = 'echo-secret-value';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function addEcho(page: Page) {
  const response = await page.request.post('/api/mcp/servers', {
    data: {
      name: 'echo-mcp',
      transport: 'stdio',
      command: process.execPath,
      args: [ECHO],
      url: null,
      env: { ECHO_TOKEN: TOKEN },
      headers: {},
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function openMcpSettings(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: 'MCP servers' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'MCP servers' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Settings lists a server switched off, turns it on for all chats and tests it', async ({
  page,
}) => {
  const empty = await openMcpSettings(page);
  await expect(empty).toContainText('No MCP servers yet');
  await expect(empty.getByRole('button', { name: /Scan/ })).toHaveCount(0);
  await addEcho(page);
  await page.reload();
  const dialog = await openMcpSettings(page);
  const card = dialog.getByRole('region', { name: 'echo-mcp' });
  const head = card.getByRole('button', { name: /^echo-mcp/ });
  await expect(head).toContainText('Added by you');
  await expect(head).toContainText('Not tested');
  await expect(head).toContainText('Off');
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  const allChats = card.getByRole('switch', { name: 'Use echo-mcp in all chats' });
  await expect(allChats).not.toBeChecked();
  await allChats.click();
  await expect(allChats).toBeChecked();
  await expect(head).toContainText('All chats');
  await expect(head).toHaveAttribute('aria-expanded', 'false');

  await head.press('Enter');
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('button', { name: 'Copy command' })).toBeVisible();
  await card.getByRole('button', { name: '1 environment variable' }).click();
  const env = card.getByRole('list', { name: 'Environment variables' });
  await expect(env).toHaveText('ECHO_TOKENin keychain');
  await expect(card).not.toContainText(TOKEN);

  await card.getByRole('button', { name: 'Test connection' }).click();
  await expect(card).toContainText('Connected · 2 tools');
  await expect(card).toContainText('echo, shout');
  await expect(head).toContainText('Works');

  const results = await new AxeBuilder({ page }).include('.set-panel').analyze();
  expect(results.violations).toEqual([]);
});

test('Settings adds a server by hand, keeps its secret out of the page and removes it', async ({
  page,
}) => {
  const dialog = await openMcpSettings(page);
  await dialog.getByRole('button', { name: 'Add server' }).click();
  const form = dialog.getByRole('form', { name: 'Add MCP server' });
  const submit = form.getByRole('button', { name: 'Add server' });
  await expect(submit).toBeDisabled();
  await form.getByRole('textbox', { name: 'Name' }).fill('bro ken');
  await form.getByRole('textbox', { name: 'Name' }).blur();
  await expect(form).toContainText('Use letters, numbers, - and _');
  await form.getByRole('textbox', { name: 'Name' }).fill('broken');
  await form.getByRole('textbox', { name: 'Command' }).fill(`/bin/sh -c 'echo nope >&2'`);
  await expect(form).toContainText('Runs /bin/sh with 2 arguments');
  await form.getByRole('button', { name: 'Add variable' }).click();
  await form.getByRole('textbox', { name: 'Environment variable 1 name' }).fill('API_KEY');
  await form.getByLabel('Environment variable 1 value').fill('typed-secret');
  await submit.click();
  await expect(form).toBeHidden();

  const card = dialog.getByRole('region', { name: 'broken' });
  const head = card.getByRole('button', { name: /^broken/ });
  await expect(head).toContainText('Added by you');
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toContainText(`/bin/sh -c 'echo nope >&2'`);
  await card.getByRole('button', { name: '1 environment variable' }).click();
  await expect(card.getByRole('list', { name: 'Environment variables' })).toHaveText(
    'API_KEYin keychain',
  );
  await card.getByRole('button', { name: 'Test connection' }).click();
  await expect(card).toContainText('Failed');
  await expect(card).toContainText('nope');
  await expect(head).toContainText('Failing');

  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = dialog.getByRole('form', { name: 'Edit broken' });
  await expect(edit.getByRole('textbox', { name: 'Command' })).toHaveValue(
    `/bin/sh -c 'echo nope >&2'`,
  );
  await expect(edit.getByLabel('Environment variable 1 value')).toHaveAttribute(
    'placeholder',
    'Saved in keychain; blank keeps it',
  );
  await edit.getByRole('button', { name: 'Cancel' }).click();

  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card).toBeHidden();
  await expect(dialog).toContainText('No MCP servers yet');
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/mcp/servers')).json()).servers.length)
    .toBe(0);
});

test('Settings fills the add form from a pasted README config', async ({ page }) => {
  const dialog = await openMcpSettings(page);
  await dialog.getByRole('button', { name: 'Add server' }).click();
  const form = dialog.getByRole('form', { name: 'Add MCP server' });
  await form.getByRole('button', { name: 'Paste config' }).click();
  await form.getByRole('textbox', { name: 'Server JSON from a README' }).fill(
    JSON.stringify({
      mcpServers: {
        docs: { type: 'sse', url: 'https://example.com/sse', headers: { 'X-Key': 'k' } },
      },
    }),
  );
  await form.getByRole('button', { name: 'Fill the form' }).click();
  await expect(form.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('docs');
  await expect(form.getByRole('radio', { name: 'SSE' })).toBeChecked();
  await expect(form.getByRole('textbox', { name: 'URL' })).toHaveValue('https://example.com/sse');
  await expect(form.getByRole('textbox', { name: 'Header 1 name' })).toHaveValue('X-Key');
  await expect(form.getByRole('button', { name: 'Add server' })).toBeEnabled();
});

test('/mcp lists the chat’s servers, switches one for this chat and links to Settings', async ({
  page,
}) => {
  await addEcho(page);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('/mcp');
  await input.press('Enter');
  const panel = page.getByRole('dialog', { name: 'MCP servers in this chat' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('echo-mcp');
  await expect(panel).toContainText('off by default');
  const toggle = panel.getByRole('switch', { name: 'Use echo-mcp in this chat' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(panel).toContainText('set for this chat');
  await expect(toggle).toBeChecked();
  await panel.getByRole('button', { name: 'Reset' }).click();
  await expect(panel).toContainText('off by default');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(input).toBeFocused();

  await input.fill('/mcp');
  await input.press('Enter');
  await page
    .getByRole('dialog', { name: 'MCP servers in this chat' })
    .getByRole('button', { name: 'Manage in Settings' })
    .click();
  await expect(page.getByRole('dialog', { name: 'MCP servers' })).toBeVisible();
});
