import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const TITLE = 'Rename the export column';
const ASKED = 'Rename the export column to Total';
const FAILURE = 'The provider connection dropped.';

async function sql<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<T>(text, values);
    return rows;
  } finally {
    await db.end();
  }
}

async function failedChat(source = 'ui'): Promise<string> {
  const [chatId] = await seedChats([
    { title: TITLE, message: ASKED, run: { status: 'failed', error: FAILURE } },
  ]);
  await sql(`UPDATE runs SET source = $2 WHERE conversation_id = $1`, [chatId, source]);
  return chatId!;
}

async function addTurn(chatId: string, status: string, content: string): Promise<void> {
  const messageId = randomUUID();
  await sql(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
    [messageId, chatId, content],
  );
  await sql(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, source, started_at,
       finished_at)
     VALUES ($1, $2, $3, 'fake', $4, 'ui', now(), CASE WHEN $4 = 'running' THEN NULL ELSE now() END)`,
    [randomUUID(), chatId, messageId, status],
  );
}

async function openSeeded(page: Page): Promise<void> {
  await openChats(page);
  await page.getByRole('navigation', { name: 'Chats' }).getByText(TITLE).click();
  await expect(page.locator('.bubble', { hasText: ASKED })).toBeVisible();
}

const tryAgain = (page: Page) => page.getByRole('button', { name: 'Try again' });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('Try again on the latest failed turn sends the same text as a new turn', async ({ page }) => {
  await failedChat();
  await openSeeded(page);
  await expect(page.locator('.error-line')).toContainText(FAILURE);
  await expect(tryAgain(page)).toBeVisible();

  const sent = page.waitForRequest(
    (request) => request.url().includes('/messages') && request.method() === 'POST',
  );
  await tryAgain(page).click();
  expect(JSON.parse((await sent).postData() ?? '{}')).toMatchObject({ content: ASKED });
  await expect(tryAgain(page)).toHaveCount(0);

  await expect(page.locator('.md', { hasText: `You wrote: "${ASKED}"` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.bubble', { hasText: ASKED })).toHaveCount(2);
  await expect(tryAgain(page)).toHaveCount(0);
});

test('Try again is not offered on an earlier failed turn', async ({ page }) => {
  const chatId = await failedChat();
  await addTurn(chatId, 'succeeded', 'A later question');
  await openSeeded(page);
  await expect(page.locator('.error-line')).toContainText(FAILURE);
  await expect(tryAgain(page)).toHaveCount(0);
});

test('Try again is not offered while another turn runs', async ({ page }) => {
  const chatId = await failedChat();
  await addTurn(chatId, 'running', 'Another question');
  await openSeeded(page);
  await expect(page.locator('.error-line')).toContainText(FAILURE);
  await expect(tryAgain(page)).toHaveCount(0);
});

test('Try again is not offered while a message is queued', async ({ page }) => {
  const chatId = await failedChat();
  await sql(
    `INSERT INTO chat_queue (id, conversation_id, position, content)
     VALUES ($1, $2, 1, 'Queued next')`,
    [randomUUID(), chatId],
  );
  await openSeeded(page);
  await expect(page.locator('.error-line')).toContainText(FAILURE);
  await expect(page.getByRole('list', { name: 'Queued messages' })).toBeVisible();
  await expect(tryAgain(page)).toHaveCount(0);
});

test('Try again is not offered when the message had an attachment', async ({ page }) => {
  const chatId = await failedChat();
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      `INSERT INTO attachments (id, workspace_id, message_id, name, media_type, kind, size, data)
       SELECT $1, $2, m.id, 'notes.txt', 'text/plain', 'text', 5, 'hello'::bytea
       FROM messages m WHERE m.conversation_id = $3`,
      [randomUUID(), workspaceId, chatId],
    );
  } finally {
    await db.end();
  }
  await openSeeded(page);
  await expect(page.locator('.error-line')).toContainText(FAILURE);
  await expect(tryAgain(page)).toHaveCount(0);
});

test('Try again is not offered for a turn the user did not type', async ({ page }) => {
  await failedChat('pr_follow_up');
  await openSeeded(page);
  await expect(page.locator('.error-line')).toContainText(FAILURE);
  await expect(tryAgain(page)).toHaveCount(0);
});
