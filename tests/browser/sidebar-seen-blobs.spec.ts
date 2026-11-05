import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.BLOB_SHOTS ?? '';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const row = (page: Page, title: string) =>
  sidebar(page).getByRole('listitem').filter({ hasText: title });
const blob = (page: Page, title: string) => row(page, title).locator('.rblob');

async function finishRun(conversationId: string) {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE runs SET status = 'succeeded', finished_at = now()
       WHERE conversation_id = $1 RETURNING id`,
      [conversationId],
    );
    await db.query(`SELECT pg_notify('changes', $1)`, [
      JSON.stringify({ kind: 'run', conversationId, runId: rows[0]!.id }),
    ]);
  } finally {
    await db.end();
  }
}

async function seenAt(conversationId: string): Promise<Date | null> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ seen_at: Date | null }>(
      'SELECT seen_at FROM conversations WHERE id = $1',
      [conversationId],
    );
    return rows[0]?.seen_at ?? null;
  } finally {
    await db.end();
  }
}

async function useScheme(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.evaluate((skin) => {
    document.documentElement.dataset.skin = skin === 'light' ? 'light' : 'graphite';
  }, scheme);
  await animationsSettled(page);
}

async function fill(page: Page, title: string): Promise<string> {
  return blob(page, title).evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => {
    const probe = document.createElement('i');
    probe.style.backgroundColor = `var(${property})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, name);
}

test('a blob shows what each chat did since you last looked, and opening it clears it', async ({
  page,
}) => {
  const [, chatB] = await seedChats([
    { title: 'Chat A' },
    { title: 'Chat B', run: { status: 'running' } },
    {
      title: 'Chat C',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Run tests', command: 'pnpm test' },
    },
    { title: 'Chat D', run: { status: 'failed', error: 'Rate limit reached.' }, unread: true },
    { title: 'Chat E', run: { status: 'running' } },
  ]);
  await openChats(page);
  await row(page, 'Chat A')
    .getByRole('button', { name: /^Chat A/ })
    .click();
  await expect(page.locator('.chat-title')).toHaveText('Chat A');

  await expect(blob(page, 'Chat A')).toHaveCount(0);
  await expect(row(page, 'Chat B').getByRole('img', { name: 'Working' })).toBeVisible();
  await expect(sidebar(page).locator('.sub')).toHaveCount(0);

  await finishRun(chatB!);
  await expect(row(page, 'Chat B').getByRole('img', { name: 'Done' })).toBeVisible();
  expect(await fill(page, 'Chat B')).toBe(await token(page, '--success'));

  await expect(row(page, 'Chat C').getByRole('img', { name: 'Waiting for you' })).toBeVisible();
  expect(await fill(page, 'Chat C')).toBe(await token(page, '--warn'));
  await expect(row(page, 'Chat D').getByRole('img', { name: 'Couldn’t finish' })).toBeVisible();
  expect(await fill(page, 'Chat D')).toBe(await token(page, '--danger'));
  await expect(row(page, 'Chat E').getByRole('img', { name: 'Working' })).toBeVisible();

  for (const scheme of ['light', 'dark'] as const) {
    await useScheme(page, scheme);
    const axe = await new AxeBuilder({ page })
      .include('nav[aria-label="Chats"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations, scheme).toEqual([]);
    if (SHOTS) await sidebar(page).screenshot({ path: `${SHOTS}/sidebar-blobs-${scheme}.png` });
  }
  await useScheme(page, 'light');

  const before = await seenAt(chatB!);
  await row(page, 'Chat B')
    .getByRole('button', { name: /^Chat B/ })
    .click();
  await expect(page.locator('.chat-title')).toHaveText('Chat B');
  await expect(blob(page, 'Chat B')).toHaveCount(0);
  await expect
    .poll(async () => (await seenAt(chatB!))?.getTime())
    .toBeGreaterThan(before?.getTime() ?? 0);

  await row(page, 'Chat A')
    .getByRole('button', { name: /^Chat A/ })
    .click();
  await expect(page.locator('.chat-title')).toHaveText('Chat A');
  await expect(blob(page, 'Chat B')).toHaveCount(0);
  await page.reload();
  await expect(row(page, 'Chat C').getByRole('img', { name: 'Waiting for you' })).toBeVisible();
  await expect(blob(page, 'Chat B')).toHaveCount(0);
});
