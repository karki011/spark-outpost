import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const since = (page: Page) => home(page).getByRole('region', { name: 'Since you left' });

async function lastSeen(interval: string | null) {
  const db = openTestDb();
  try {
    await db.query('UPDATE profiles SET home_seen_at = now() - $1::interval', [interval]);
  } finally {
    await db.end();
  }
}

async function seedUpdates() {
  await seedChats([
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' }, unread: true },
  ]);
}

const seenWritten = (page: Page) =>
  page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/home/seen' &&
      response.request().method() === 'POST',
  );

test.use({ actionTimeout: 15_000 });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date());
  await resetTestDatabase({ onboarded: true });
});

test('the first view shows the updates and records the visit after a short dwell', async ({
  page,
}) => {
  await seedUpdates();
  const written = seenWritten(page);
  await page.goto('/');
  await expect(since(page).locator('.hrow-m b')).toHaveText(['Mock fetch', 'Ship the notes'], {
    timeout: 15_000,
  });

  expect((await written).ok()).toBe(true);
  await expect(since(page).locator('.hrow-m b')).toHaveText(['Mock fetch', 'Ship the notes']);

  await page.reload();
  await expect(home(page).getByRole('heading', { level: 1 })).not.toBeEmpty({ timeout: 15_000 });
  await expect(since(page)).toHaveCount(0);
});

test('a visit less than 30 minutes ago shows no lead for new updates', async ({ page }) => {
  await lastSeen('10 minutes');
  await seedUpdates();
  await page.goto('/');
  await expect(home(page).getByRole('heading', { level: 1 })).not.toBeEmpty({ timeout: 15_000 });
  await expect(since(page)).toHaveCount(0);
});

test('after 30 minutes away only the updates since the last visit show', async ({ page }) => {
  await seedUpdates();
  const db = openTestDb();
  try {
    await db.query(
      `UPDATE runs SET finished_at = now() - interval '3 hours'
       WHERE conversation_id = (SELECT id FROM conversations WHERE title = 'Ship the notes')`,
    );
  } finally {
    await db.end();
  }
  await lastSeen('2 hours');
  await page.goto('/');
  await expect(since(page).locator('.hrow-m b')).toHaveText(['Mock fetch'], { timeout: 15_000 });
});
