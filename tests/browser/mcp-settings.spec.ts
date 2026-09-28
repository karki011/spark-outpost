import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { MCP_SCAN_HOME } from './stub-config.ts';

const ECHO = path.resolve('apps/server/test/echo-mcp-server.mjs');
const TOKEN = 'cursor-secret-value';

test.beforeAll(() => {
  rmSync(MCP_SCAN_HOME, { recursive: true, force: true });
  mkdirSync(path.join(MCP_SCAN_HOME, '.cursor'), { recursive: true });
  writeFileSync(
    path.join(MCP_SCAN_HOME, '.cursor', 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        'cursor-echo': { command: process.execPath, args: [ECHO], env: { ECHO_TOKEN: TOKEN } },
      },
    }),
  );
});

test.afterAll(() => {
  rmSync(MCP_SCAN_HOME, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function openMcpSettings(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile' })
    .getByRole('tab', { name: 'MCP servers' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'MCP servers' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Settings scans other apps, imports servers switched off and moves values to the keychain', async ({
  page,
}) => {
  const dialog = await openMcpSettings(page);
  await expect(dialog).toContainText('No MCP servers yet');
  await dialog.getByRole('button', { name: 'Scan other apps' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Checked these files' })).toContainText(
    'Cursor · 1 server',
  );
  const card = dialog.getByRole('region', { name: 'cursor-echo' });
  await expect(card).toContainText('From Cursor');
  await expect(card).toContainText('Env: ECHO_TOKEN');
  await expect(card).not.toContainText(TOKEN);
  const allChats = card.getByRole('switch', { name: 'Use cursor-echo in all chats' });
  await expect(allChats).not.toBeChecked();

  await card.getByRole('button', { name: 'Copy value to keychain' }).click();
  await expect(card).toContainText('in keychain: ECHO_TOKEN');
  await expect(card.getByRole('button', { name: /Copy value/ })).toBeHidden();

  await allChats.click();
  await expect(allChats).toBeChecked();

  await card.getByRole('button', { name: 'Test connection' }).click();
  await expect(card).toContainText('Connected · 2 tools');
  await expect(card).toContainText('echo, shout');

  const results = await new AxeBuilder({ page }).include('.set-panel').analyze();
  expect(results.violations).toEqual([]);
});

test('Settings adds a server by hand, keeps its secret out of the page and removes it', async ({
  page,
}) => {
  const dialog = await openMcpSettings(page);
  await dialog.getByRole('button', { name: 'Add server' }).click();
  const form = dialog.getByRole('form', { name: 'Add an MCP server' });
  await form.getByRole('textbox', { name: 'Name' }).fill('broken');
  await form.getByRole('textbox', { name: 'Command' }).fill('/bin/sh');
  await form.getByRole('textbox', { name: 'Arguments, one per line' }).fill('-c\necho nope >&2');
  await form.getByRole('button', { name: 'Add environment variable' }).click();
  await form.getByRole('textbox', { name: 'Environment variable 1 name' }).fill('API_KEY');
  await form.getByLabel('Environment variable 1 value').fill('typed-secret');
  await form.getByRole('button', { name: 'Add server' }).click();
  await expect(form).toBeHidden();

  const card = dialog.getByRole('region', { name: 'broken' });
  await expect(card).toContainText('Added by you');
  await expect(card).toContainText('/bin/sh -c echo nope >&2');
  await expect(card).toContainText('in keychain: API_KEY');
  await card.getByRole('button', { name: 'Test connection' }).click();
  await expect(card).toContainText('Failed');
  await expect(card).toContainText('nope');

  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = dialog.getByRole('form', { name: 'Edit broken' });
  await expect(edit.getByLabel('Environment variable 1 value')).toHaveAttribute(
    'placeholder',
    'Saved in keychain; blank keeps it',
  );
  await edit.getByRole('button', { name: 'Cancel' }).click();

  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await card.getByRole('button', { name: 'Remove broken' }).click();
  await expect(card).toBeHidden();
  await expect(dialog).toContainText('No MCP servers yet');
});

test('/mcp lists the chat’s servers, switches one for this chat and links to Settings', async ({
  page,
}) => {
  const scan = await page.request.post('/api/mcp/scan', { data: {} });
  expect(scan.ok(), await scan.text()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('/mcp');
  await input.press('Enter');
  const panel = page.getByRole('dialog', { name: 'MCP servers in this chat' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('cursor-echo');
  await expect(panel).toContainText('off by default');
  const toggle = panel.getByRole('switch', { name: 'Use cursor-echo in this chat' });
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
