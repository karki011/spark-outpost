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

const timer = (page: Page) => page.locator('.cache-timer');

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('the context bar counts the cache down, then says what the next message re-writes', async ({
  page,
}) => {
  const { runId } = await claudeChat('succeeded');
  await cached(runId, 3600, 18);
  await open(page);

  await expect(timer(page)).toHaveText('Cache warm · 42 min left');
  await expect(timer(page)).toHaveAttribute('data-cache-state', 'warm');
  await timer(page).hover();
  await page.clock.runFor(500);
  await expect(page.getByRole('tooltip')).toContainText('1 hour after the last request');

  await page.clock.fastForward(MINUTE);
  await expect(timer(page)).toHaveText('Cache warm · 41 min left');
  await page.clock.fastForward(41 * MINUTE);
  await expect(timer(page)).toHaveText('Cache cold · next message re-writes ~182K tokens (~$1.46)');
  await expect(page.getByRole('status').filter({ hasText: 'Prompt cache expired' })).toHaveCount(1);
});

test('without a known lifetime it shows only when the cache was last used', async ({ page }) => {
  const { runId } = await claudeChat('succeeded');
  await cached(runId, null, 12);
  await open(page);

  await expect(timer(page)).toHaveText('Cache last used 12 min ago');
  await expect(timer(page)).toHaveAttribute('data-cache-state', 'unknown');
  await expect(page.getByText(/Cache warm|Cache cold/)).toHaveCount(0);
});

test('a running turn shows no timer', async ({ page }) => {
  const { runId } = await claudeChat('running');
  await cached(runId, 3600, 2);
  await open(page);

  await expect(page.locator('.ctx-unlinked')).toBeVisible();
  await expect(timer(page)).toHaveCount(0);
});

test('no timer while the agent waits on a card', async ({ page }) => {
  const { runId } = await claudeChat('awaiting_approval', {
    kind: 'command',
    title: 'Run pnpm test?',
    command: 'pnpm test',
  });
  await cached(runId, 3600, 2);
  await open(page);

  await expect(page.getByRole('group', { name: /Run pnpm test\?/ })).toBeVisible();
  await expect(timer(page)).toHaveCount(0);
});

test('no timer while background sub-agents still work', async ({ page }) => {
  const { runId } = await claudeChat('running');
  await cached(runId, 3600, 2);
  await sql(
    `INSERT INTO run_events (run_id, seq, type, payload) VALUES ($1, 1, 'ACTIVITY_SNAPSHOT', $2)`,
    [
      runId,
      JSON.stringify({
        type: 'ACTIVITY_SNAPSHOT',
        messageId: 'subagents',
        activityType: 'subagents',
        content: { waitingOn: 2 },
      }),
    ],
  );
  await open(page);

  await expect(page.getByText('Waiting on 2 sub-agents').first()).toBeVisible();
  await expect(timer(page)).toHaveCount(0);
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
  await expect(timer(page)).toHaveText('Cache warm · 59 min left');
});
