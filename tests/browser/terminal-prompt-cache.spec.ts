import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';
import { seedTerminal, setTerminalState } from './terminal-seed.ts';

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

async function terminalChat(state: string, minutesAgo: number) {
  const [chatId] = await seedChats([{ title: 'Port the parser' }]);
  await seedTerminal(chatId!, {
    state,
    turn: { status: 'succeeded', model: 'claude-opus-5-5', costUsd: 0.5 },
  });
  const [run] = await sql('SELECT id FROM runs WHERE conversation_id = $1', [chatId]);
  const runId = (run as { id: string }).id;
  await sql(
    `INSERT INTO run_prompt_cache (run_id, first_key, first_write, last_key, last_context, last_at,
       model)
     VALUES ($1, 't:0', 2000, 't:1', 182000, $2, 'claude-opus-5-5')`,
    [runId, new Date(NOW - minutesAgo * MINUTE)],
  );
  return { chatId: chatId!, runId };
}

const bar = (page: Page) =>
  page.getByRole('region', { name: 'Terminal session', exact: true }).locator('.tbar');
const timer = (page: Page) => bar(page).locator('.cache-timer');

async function open(page: Page) {
  await page.clock.install({ time: NOW });
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText(/./);
  await expect(bar(page)).toBeVisible();
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('the Terminal bar counts down from the last request with the lifetime the session file showed', async ({
  page,
}) => {
  const { chatId } = await terminalChat('ready', 3);
  await sql(
    'UPDATE native_terminal_sessions SET cache_ttl_seconds = 300 WHERE conversation_id = $1',
    [chatId],
  );
  await open(page);

  await expect(timer(page)).toHaveText('Cache warm · 2 min left');
  await page.clock.fastForward(2 * MINUTE);
  await expect(timer(page)).toHaveText('Cache cold · next message re-writes ~182K tokens (~$0.91)');
});

test('the Terminal Cost tab shows the cache hit rate', async ({ page }) => {
  const { runId } = await terminalChat('ready', 3);
  await sql(
    `UPDATE runs SET input_tokens = 100, output_tokens = 50, cached_read_tokens = 900,
       cached_write_tokens = 0, total_tokens = 1050 WHERE id = $1`,
    [runId],
  );
  await open(page);
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  const show = page.getByRole('button', { name: 'Show work panel' });
  if (await show.isVisible()) await show.click();
  await panel.getByRole('tab', { name: 'Cost' }).click();
  await expect(panel.locator('.tu-hit')).toHaveText('Cache hit 90%');
});

test('the Terminal bar says only when the cache was last used when the lifetime is unknown', async ({
  page,
}) => {
  await terminalChat('ready', 12);
  await open(page);

  await expect(timer(page)).toHaveText('Cache last used 12 min ago');
});

test('a Claude Code resume that says the cache expired shows cold at once', async ({ page }) => {
  const { chatId } = await terminalChat('ready', 300);
  await sql(
    `UPDATE native_terminal_sessions SET cache_resume = $2::jsonb WHERE conversation_id = $1`,
    [
      chatId,
      JSON.stringify({
        at: NOW - MINUTE,
        secondsSince: 4000,
        contextTokens: 330_000,
        likelyExpired: true,
        estimatedWriteUsd: 6.6,
      }),
    ],
  );
  await open(page);

  await expect(timer(page)).toHaveText('Cache cold · next message re-writes ~330K tokens (~$6.60)');
});

test('no timer while the agent works, waits on a card, or sub-agents still run', async ({
  page,
}) => {
  const { chatId, runId } = await terminalChat('working', 1);
  await sql(
    'UPDATE native_terminal_sessions SET cache_ttl_seconds = 3600 WHERE conversation_id = $1',
    [chatId],
  );
  await open(page);
  await expect(bar(page).locator('.tbar-state')).toBeVisible();
  await expect(timer(page)).toHaveCount(0);

  await setTerminalState(chatId, 'waiting_for_permission');
  await page.clock.fastForward(3_000);
  await expect(bar(page).locator('.tbar-state')).toHaveText(/permission/i);
  await expect(timer(page)).toHaveCount(0);

  await sql(
    `INSERT INTO native_terminal_mod_turns (run_id, turn_id, agent_id, started_at)
     VALUES ($1, 'sub-turn', 'agent-a', now())`,
    [runId],
  );
  await setTerminalState(chatId, 'ready');
  await page.clock.fastForward(3_000);
  await expect(bar(page).locator('.tbar-state')).not.toHaveText(/permission/i);
  await expect(timer(page)).toHaveCount(0);

  await sql(`UPDATE native_terminal_mod_turns SET duration_ms = 5000 WHERE turn_id = 'sub-turn'`);
  await page.clock.fastForward(3_000);
  await expect(timer(page)).toHaveText(/^Cache warm · \d+ min left$/);
});
