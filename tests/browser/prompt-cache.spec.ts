import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats, type SeedApproval } from './sidebar-seed.ts';

const MINUTE = 60_000;
const NOW = new Date('2026-10-17T15:00:00Z').getTime();

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return (await db.query(text, values)).rows;
  } finally {
    await db.end();
  }
}

async function claudeChat(status: string, approval?: SeedApproval) {
  const [chatId] = await seedChats([
    { title: 'Cache chat', run: { status }, ...(approval ? { approval } : {}) },
  ]);
  const [run] = await sql(
    `UPDATE runs SET provider = 'claude', used_model = 'claude-opus-5-5',
       finished_at = CASE WHEN $2 THEN now() END
     WHERE conversation_id = $1 RETURNING id`,
    [chatId, !['running', 'queued', 'awaiting_approval'].includes(status)],
  );
  return { chatId: chatId!, runId: (run as { id: string }).id };
}

async function cached(runId: string, ttl: number | null, minutesAgo: number, firstWrite = 2_000) {
  await sql(
    `INSERT INTO run_prompt_cache (run_id, first_key, first_write, last_key, last_context, last_at,
       model, ttl_seconds)
     VALUES ($1, 'a', $2, 'b', 182000, $3, 'claude-opus-5-5', $4)`,
    [runId, firstWrite, new Date(NOW - minutesAgo * MINUTE), ttl],
  );
}

async function open(page: Page) {
  await page.clock.install({ time: NOW });
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText(/./);
}

const ring = (page: Page) => page.locator('.ctxbtn');
const badge = (page: Page) => ring(page).locator('[data-cache-badge]');

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('the context ring badge counts the cache down, then says what the next message re-writes', async ({
  page,
}) => {
  const { runId } = await claudeChat('succeeded');
  await cached(runId, 3600, 18);
  await open(page);

  await expect(page.locator('.comp-bar').getByText(/Cache warm|Cache cold/)).toHaveCount(0);
  await expect(badge(page)).toHaveAttribute('data-cache-badge', 'warm');
  await expect(ring(page)).toHaveAccessibleName(/\. Prompt cache warm · 42 min left$/);
  await expect(ring(page)).toHaveAttribute('title', /Prompt cache warm · 42 min left/);
  await ring(page).click();
  const row = page.locator('.ctx-cache');
  await expect(row).toContainText('Warm · 42 min left');
  await expect(row).toContainText('1 hour after the last request');
  await page.keyboard.press('Escape');

  await page.clock.fastForward(MINUTE);
  await expect(ring(page)).toHaveAccessibleName(/Prompt cache warm · 41 min left$/);
  await page.clock.fastForward(36 * MINUTE);
  await expect(badge(page)).toHaveAttribute('data-cache-badge', 'expiring');
  await expect(ring(page)).toHaveAccessibleName(/Prompt cache expires in 5 min$/);
  await page.clock.fastForward(5 * MINUTE);
  await expect(badge(page)).toHaveAttribute('data-cache-badge', 'expired');
  await expect(ring(page)).toHaveAccessibleName(
    /Prompt cache expired, next message re-writes ~182K tokens \(~\$1\.46\)$/,
  );
  await expect(
    page.locator('[aria-live="polite"]').filter({ hasText: 'Prompt cache expired' }),
  ).toHaveCount(1);
});

test('without a known lifetime it shows only when the cache was last used', async ({ page }) => {
  const { runId } = await claudeChat('succeeded');
  await cached(runId, null, 12);
  await open(page);

  await expect(badge(page)).toHaveAttribute('data-cache-badge', 'unknown');
  await expect(ring(page)).toHaveAccessibleName(/Prompt cache last used 12 min ago$/);
});

test('a running turn shows no cache badge', async ({ page }) => {
  const { runId } = await claudeChat('running');
  await cached(runId, 3600, 2);
  await open(page);

  await expect(
    page.locator('.comp-foot').getByRole('button', { name: 'Choose project' }),
  ).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
  await expect(ring(page)).toHaveCount(0);
});

test('no cache badge while the agent waits on a card', async ({ page }) => {
  const { runId } = await claudeChat('awaiting_approval', {
    kind: 'execute',
    title: 'Run a command?',
    command: 'pnpm test',
  });
  await cached(runId, 3600, 2);
  await open(page);

  await expect(page.getByRole('group', { name: /^Run .+\?$/ })).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
  await expect(ring(page)).toHaveCount(0);
});

test('a turn that re-wrote the cache carries a dim note', async ({ page }) => {
  const { chatId, runId } = await claudeChat('succeeded');
  await cached(runId, 3600, 90);
  const [message] = await sql(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES (gen_random_uuid(), $1, 'user', 'again')
     RETURNING id`,
    [chatId],
  );
  const [second] = await sql(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, used_model,
       started_at, finished_at)
     VALUES (gen_random_uuid(), $1, $2, 'claude', 'succeeded', 'claude-opus-5-5', now(), now())
     RETURNING id`,
    [chatId, (message as { id: string }).id],
  );
  const secondId = (second as { id: string }).id;
  await sql(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     VALUES (gen_random_uuid(), $1, 'assistant', 'Done again.', $2)`,
    [chatId, secondId],
  );
  await cached(secondId, null, 1, 182_000);
  await open(page);

  await expect(page.getByText('This turn re-wrote 182K tokens (~$1.46)')).toBeVisible();
  await expect(ring(page)).toHaveAccessibleName(/Prompt cache warm · 59 min left$/);
});
