import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const TURNS = 24;
const FOUND_TURN = 2;
const FOUND_TEXT = 'Plan the <script>window.__pwned = true</script> **unicorn** migration';
const FILLER = 'We checked every table and kept the rows in order. '.repeat(8);

async function seedLongChat(): Promise<void> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const long = randomUUID();
    await db.query(
      `INSERT INTO conversations (id, workspace_id, title, updated_at, seen_at)
       VALUES ($1, $2, 'Database moves', now() - interval '1 hour', now())`,
      [long, workspaceId],
    );
    for (let turn = 0; turn < TURNS; turn += 1) {
      const messageId = randomUUID();
      const runId = randomUUID();
      const at = new Date(Date.now() - (TURNS - turn) * 60_000);
      await db.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, 'user', $3, $4)`,
        [messageId, long, turn === FOUND_TURN ? FOUND_TEXT : `Step ${turn}`, at],
      );
      await db.query(
        `INSERT INTO runs (id, conversation_id, user_message_id, provider, status,
           created_at, started_at, finished_at)
         VALUES ($1, $2, $3, 'fake', 'succeeded', $4, $4, $4)`,
        [runId, long, messageId, at],
      );
      await db.query(
        `INSERT INTO messages (id, conversation_id, role, content, run_id, created_at)
         VALUES ($1, $2, 'assistant', $3, $4, $5)`,
        [randomUUID(), long, `Reply ${turn}. ${FILLER}`, runId, at],
      );
    }
    const other = randomUUID();
    await db.query(
      `INSERT INTO conversations (id, workspace_id, title, seen_at)
       VALUES ($1, $2, 'Newest chat', now())`,
      [other, workspaceId],
    );
    await db.query(
      `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', 'Hi')`,
      [randomUUID(), other],
    );
  } finally {
    await db.end();
  }
}

const foundBubble = (page: Page) =>
  page.locator('.msg.me .bubble').filter({ hasText: 'window.__pwned' });
const lastReply = (page: Page) => page.getByText(`Reply ${TURNS - 1}.`);

async function expectJumped(page: Page) {
  await expect(
    page.getByRole('navigation', { name: 'Chats' }).locator('[aria-current="page"]'),
  ).toContainText('Database moves');
  await expect(foundBubble(page)).toBeInViewport();
  await expect(lastReply(page)).not.toBeInViewport();
  await page.waitForTimeout(600);
  await expect(foundBubble(page)).toBeInViewport();
  expect(await page.evaluate(() => 'pwned' in window || '__pwned' in window)).toBe(false);
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await seedLongChat();
});

test('a Sessions match shows its snippet as text and opens the chat at that message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChats(page);
  await page.keyboard.press('ControlOrMeta+Shift+K');
  const palette = page.getByRole('dialog', { name: 'Sessions' });
  await palette.getByRole('combobox', { name: 'Find a session' }).fill('unicor');

  const row = palette.getByRole('option').filter({ hasText: 'Database moves' });
  const snippet = row.locator('.match-snippet');
  await expect(snippet).toHaveText(FOUND_TEXT);
  await expect(snippet.locator('mark')).toHaveText(['unicorn']);
  await expect(snippet.locator('script, strong')).toHaveCount(0);

  await page.keyboard.press('Enter');
  await expectJumped(page);
});

test('a sidebar search match shows its snippet and opens the chat at that message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChats(page);
  await page.getByRole('searchbox', { name: 'Search chats' }).fill('unicorn migr');

  const nav = page.getByRole('navigation', { name: 'Chats' });
  const row = nav.locator('[data-chat]').filter({ hasText: 'Database moves' });
  await expect(row.locator('.match-snippet mark')).toHaveText(['unicorn', 'migration']);
  await expect(nav.locator('[data-chat]')).toHaveCount(1);

  await row
    .getByRole('button', { name: /Database moves/ })
    .first()
    .click();
  await expectJumped(page);
});
