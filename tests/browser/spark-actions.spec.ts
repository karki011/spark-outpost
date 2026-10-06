import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetCrew, send } from './crew-engine.ts';
import { openChats } from './navigation.ts';
import { connectTickets, resetTicketFakes, slowTicketCreates } from './ticket-seed.ts';

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

const PROGRESS_SHOTS = process.env.SPARK_ACTION_SHOTS;

async function shoot(page: Page, name: string) {
  if (!PROGRESS_SHOTS) return;
  const card = page.getByRole('group', { name: /Create this ticket\?/ });
  const tasks = page.getByRole('complementary', { name: 'Work panel' });
  for (const skin of ['light', 'graphite']) {
    await page.evaluate((value) => (document.documentElement.dataset.skin = value), skin);
    await card.screenshot({ path: `${PROGRESS_SHOTS}/card-${name}-${skin}.png` });
    await tasks.screenshot({ path: `${PROGRESS_SHOTS}/tasks-${name}-${skin}.png` });
  }
  await page.evaluate(() => (document.documentElement.dataset.skin = 'light'));
}

test('a confirmed action says what Spark is doing, then fails plainly, then succeeds on Try again', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await connectTickets(page, ['linear']);
  await slowTicketCreates(4_000, 1);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await send(page, '#build #spark spark_create_ticket {"project":"ENG","title":"Crash on save"}');

  const card = page.getByRole('group', { name: /Create this ticket\?/ });
  await expect(card).toBeVisible({ timeout: 45_000 });
  const tasks = page.getByRole('complementary', { name: 'Work panel' });
  await card.getByRole('button', { name: 'Create ticket' }).click();

  await expect(card).toContainText('Confirmed. Creating the ticket…');
  await expect(card.locator('.appr-busy')).toBeVisible();
  await expect(card.getByRole('status')).toContainText('Creating the ticket…');
  const working = tasks.getByRole('listitem').filter({ hasText: 'Creating the ticket…' });
  await expect(working.getByRole('img', { name: 'Working' })).toBeVisible({ timeout: 10_000 });
  await expect(working).not.toContainText('Allowed');
  await shoot(page, 'in-progress');

  await expect(card).toContainText('It failed.', { timeout: 30_000 });
  await expect(card).toContainText('Linear is not taking new issues');
  const failed = tasks.getByRole('listitem').filter({ hasText: 'Create this ticket?' });
  await expect(failed).toContainText('Failed', { timeout: 10_000 });
  const retry = card.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible();
  await expect(retry).not.toBeFocused();
  await shoot(page, 'failed');

  await retry.click();
  await expect(card).toContainText('Creating the ticket…');
  await expect(card).toContainText(/Created ENG-\d+\./, { timeout: 30_000 });
  await expect(card.getByRole('status')).toContainText(/Created ENG-\d+\./);
  await expect(card.getByRole('link', { name: /Open: Created ENG-\d+/ })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  const done = tasks.getByRole('listitem').filter({ hasText: /Created ENG-\d+\./ });
  await expect(done).toContainText('Done', { timeout: 10_000 });
  await shoot(page, 'done');
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.appr.resolved')
    .analyze();
  expect(scan.violations).toEqual([]);
});
