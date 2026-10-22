import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const TITLE = 'Third in line';

async function queueBehindOthers(): Promise<void> {
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
}

const row = (page: Page) =>
  page.getByRole('navigation', { name: 'Chats' }).getByRole('listitem').filter({ hasText: TITLE });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a queued turn says it is waiting to start and how many runs are ahead', async ({ page }) => {
  await queueBehindOthers();
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
});
