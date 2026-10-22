import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { notifyChanged, seedChats } from './sidebar-seed.ts';

const TITLE = 'Third in line';

async function queueBehindOthers(): Promise<string[]> {
  const ids = await seedChats([
    { title: 'First in line', minutesAgo: 30, run: { status: 'queued' } },
    { title: 'Second in line', minutesAgo: 20, run: { status: 'queued' } },
    { title: TITLE, minutesAgo: 0, run: { status: 'queued' } },
  ]);
  const db = openTestDb();
  try {
    for (const [index, chatId] of ids.entries()) {
      await db.query(
        `INSERT INTO jobs (id, run_id, status, available_at)
         SELECT gen_random_uuid(), id, 'queued', now() + make_interval(hours => 1, secs => $2)
         FROM runs WHERE conversation_id = $1`,
        [chatId, index],
      );
    }
  } finally {
    await db.end();
  }
  return ids;
}

async function startFirst(chatId: string): Promise<void> {
  const db = openTestDb();
  try {
    await db.query(
      `UPDATE jobs SET status = 'leased' WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = $1)`,
      [chatId],
    );
  } finally {
    await db.end();
  }
  await notifyChanged('conversation', chatId);
}

const row = (page: Page) =>
  page.getByRole('navigation', { name: 'Chats' }).getByRole('listitem').filter({ hasText: TITLE });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a queued turn says it is waiting to start and how many runs are ahead', async ({ page }) => {
  const [first] = await queueBehindOthers();
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText(TITLE);

  await expect(row(page).locator('.row-open')).toHaveAttribute(
    'title',
    /Waiting to start · 2 ahead/,
  );
  const head = page.locator('.msg.ai .ai-head').last();
  await expect(head.locator('.mood')).toHaveText('waiting to start · 2 ahead');
  await expect(head).not.toContainText(/thinking|working/);
  const status = page.locator('.cstatus');
  await expect(status).toContainText('is waiting to start · 2 ahead');
  await expect(status).not.toContainText(/thinking|working/);

  await startFirst(first!);
  await expect(head.locator('.mood')).toHaveText('waiting to start · 1 ahead');
  await expect(status).toContainText('is waiting to start · 1 ahead');
  await expect(row(page).locator('.row-open')).toHaveAttribute(
    'title',
    /Waiting to start · 1 ahead/,
  );
});
