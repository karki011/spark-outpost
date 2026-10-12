import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';
import { resetWithAgents } from './project-chat-kit.ts';

const SHOTS = process.env.SPARK_REVIEW_SHOTS ?? '';

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) });
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetWithAgents();
  await page.setViewportSize({ width: 1400, height: 900 });
});

async function ask(page: Page, text: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  return input;
}

const mood = (page: Page) => page.locator('.msg.ai .mood').last();
const rowsIn = (scope: ReturnType<Page['locator']>) =>
  scope.getByRole('list', { name: 'Sub-agents' }).getByRole('listitem');

test('a turn lists its sub-agents, says the agent waits on them, and stops them with the turn', async ({
  page,
}) => {
  const input = await ask(page, 'Split the work #build #subagentshold');
  const turn = page.locator('.msg.ai').last();
  const summary = turn.getByRole('button', { name: '2 sub-agents · 2 working' });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(mood(page)).toHaveText('waiting on 2 sub-agents');

  const rows = rowsIn(turn);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Explore');
  await expect(rows.nth(0)).toContainText('Working');
  await expect(rows.nth(0)).toContainText('Read routes.ts');
  await expect(rows.nth(0)).toContainText('Find the routes');
  await expect(rows.nth(1)).toContainText('Tests');

  const sidebar = page.getByRole('navigation', { name: 'Chats' });
  await expect(sidebar.getByText('Waiting on 2 sub-agents')).toBeVisible({ timeout: 10_000 });

  await input.fill('still typing');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('still typing');
  await shot(page, 'subagents-chat-waiting.png');

  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect(rows).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(summary).toBeFocused();

  await toggleHeaderPane(page, 'Agent TV');
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect(tv.getByRole('button', { name: '2 sub-agents · 2 working' })).toBeVisible();
  await expect(rowsIn(tv)).toHaveCount(2);
  await tv.getByRole('radio', { name: 'List' }).click();
  await expect(tv.getByRole('list', { name: 'Running' })).toContainText(
    /waiting on 2 sub-agents/i,
    {
      timeout: 10_000,
    },
  );
  await shot(page, 'subagents-agent-tv.png');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(turn.getByRole('button', { name: '2 sub-agents · 2 cancelled' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(sidebar.getByText('Waiting on 2 sub-agents')).toHaveCount(0);
});

test('a finished turn keeps its sub-agents, nested ones under their parent, after a reload', async ({
  page,
}) => {
  await ask(page, 'Split the work #build #subagents');
  await expect(mood(page)).toHaveText('done', { timeout: 30_000 });
  const turn = page.locator('.msg.ai').last();
  const summary = turn.getByRole('button', { name: '3 sub-agents · 2 done, 1 failed' });
  await expect(summary).toBeVisible();
  await expect(turn.locator('.md')).toContainText('All done');
  await expect(turn.locator('.md')).not.toContainText('child words');

  await page.reload();
  const again = page.locator('.msg.ai').last();
  const rows = rowsIn(again);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Explore');
  await expect(rows.nth(1)).toContainText('Nested');
  await expect(rows.nth(1)).toHaveAttribute('data-nested', 'true');
  await expect(rows.nth(2)).toContainText('Tests');
  await expect(rows.nth(2)).toContainText('Failed');
  await shot(page, 'subagents-chat-finished.png');
});
