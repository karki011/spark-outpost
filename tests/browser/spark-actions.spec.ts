import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resetCrew, send } from './crew-engine.ts';
import { openChats } from './navigation.ts';
import { connectTickets, resetTicketFakes } from './ticket-seed.ts';

const SHOTS = process.env.SPARK_SHEET_SHOTS;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  await resetTicketFakes();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('an agent asks to create a ticket and the user edits and confirms it on a card', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await connectTickets(page, ['linear']);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();

  await send(
    page,
    '#build #spark spark_create_ticket {"project":"ENG","title":"Crash on save","priority":"high"}',
  );

  const card = page.getByRole('group', { name: /Create this ticket\?/ });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card).toContainText('Linear · ENG');
  await expect(card).toContainText('Nothing happens until you confirm');
  await expect(card.getByRole('button', { name: 'Priority' })).toHaveText('High');
  await card.getByLabel('Title').fill('Crash when saving drafts');
  await card.getByRole('button', { name: 'Create ticket' }).click();

  await expect(page.getByText(/"outcome":"waiting_for_user"/)).toBeVisible({ timeout: 30_000 });
  const resolved = page.getByRole('group', { name: /Create this ticket\?/ });
  await expect(resolved).toContainText(/Created ENG-\d+\./, { timeout: 30_000 });
  await expect(resolved.getByRole('link', { name: /Open: Created ENG-\d+/ })).toBeVisible();
});

test('an agent asks to add an MCP server and the card shows the exact command', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();

  await send(
    page,
    '#build #spark spark_add_mcp_server {"name":"github","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":["GITHUB_TOKEN"]}',
  );

  const card = page.getByRole('group', { name: /Add this MCP server\?/ });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card).toContainText('github · Command on your computer');
  await expect(card.locator('code.mcp-fact-cmd')).toHaveText(
    'npx -y @modelcontextprotocol/server-github',
  );
  await expect(card).toContainText('This command runs on your computer');
  await expect(card).toContainText('Needs a value for GITHUB_TOKEN');
  await expect(card).toContainText('new agent sessions');
  await expect(card.getByRole('textbox')).toHaveCount(0);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.sac')
    .analyze();
  expect(scan.violations).toEqual([]);
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/spark-sheet-mcp-card.png` });
  expect(
    ((await (await page.request.get('/api/mcp/servers')).json()) as { servers: [] }).servers,
  ).toHaveLength(0);

  await card.getByRole('button', { name: 'Add server' }).click();
  const resolved = page.getByRole('group', { name: /Add this MCP server\?/ });
  await expect(resolved).toContainText('Fill GITHUB_TOKEN in Settings → MCP servers', {
    timeout: 30_000,
  });
  if (SHOTS) await resolved.screenshot({ path: `${SHOTS}/spark-sheet-mcp-card-done.png` });

  await resolved.getByRole('button', { name: 'Open MCP servers' }).click();
  const settings = page.getByRole('dialog', { name: 'MCP servers' });
  const server = settings.getByRole('region', { name: 'github' });
  await expect(server).toBeVisible();
  await expect(server.getByRole('switch', { name: 'Use github in all chats' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});
