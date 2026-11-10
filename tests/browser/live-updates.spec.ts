import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const QUIET_WINDOW_MS = 5_000;

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const section = (page: Page, name: string | RegExp) => home(page).getByRole('region', { name });

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    await db.query(text, values);
  } finally {
    await db.end();
  }
}

const finishRun = (conversationId: string) =>
  sql(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE conversation_id = $1`, [
    conversationId,
  ]);

const dropLiveUpdateListener = () =>
  sql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = current_database() AND query = 'LISTEN changes'`,
  );

function countListRequests(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/conversations') count += 1;
  });
  return () => count;
}

async function openHomeWithRunningChat(page: Page, title: string): Promise<string> {
  await resetTestDatabase({ onboarded: true });
  const [, chatId] = await seedChats([
    { title: 'Current chat' },
    { title, run: { status: 'running' } },
  ]);
  const connected = page.waitForResponse(
    (response) => response.url().endsWith('/api/events') && response.status() === 200,
  );
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await expect(section(page, /^Working/)).toContainText(title);
  await connected;
  return chatId!;
}

test('Home moves a chat to Needs you when it finishes, without polling', async ({ page }) => {
  const listRequests = countListRequests(page);
  const chatId = await openHomeWithRunningChat(page, 'Filter chips overflow');

  const before = listRequests();
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(listRequests()).toBe(before);

  await finishRun(chatId);
  await expect(
    section(page, 'Ready for you to review').getByRole('button', {
      name: 'Review: Filter chips overflow',
    }),
  ).toBeVisible({ timeout: 5_000 });
  expect(listRequests() - before).toBeLessThanOrEqual(2);
});

test('live updates reconnect after the server drops them and catch up on missed changes @packaged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  let blocked = false;
  await page.route('**/api/events', (route) =>
    blocked
      ? route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' })
      : route.continue(),
  );
  const chatId = await openHomeWithRunningChat(page, 'Worktree cleanup');

  blocked = true;
  await dropLiveUpdateListener();
  await finishRun(chatId);
  await page.waitForTimeout(1_500);
  await expect(section(page, /^Working/)).toContainText('Worktree cleanup');

  const hint = page.getByRole('status').filter({ hasText: 'Live updates paused, retrying' });
  await expect(hint).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.reconnect')).toHaveCount(0);

  blocked = false;
  await expect(
    section(page, 'Ready for you to review').getByRole('button', {
      name: 'Review: Worktree cleanup',
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(hint).toBeHidden();
});
