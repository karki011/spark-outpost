import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

interface Thresholds {
  warn: number;
  compact: number;
  auto: boolean;
}

const DEFAULTS: Thresholds = { warn: 60, compact: 80, auto: true };
const ASKS_FIRST: Thresholds = { ...DEFAULTS, auto: false };

async function startAt(thresholds = DEFAULTS) {
  await resetTestDatabase({ onboarded: true });
  const db = openTestDb();
  try {
    await db.query(
      `UPDATE profiles SET compact_warn_percent = $1, compact_at_percent = $2, auto_compact = $3`,
      [thresholds.warn, thresholds.compact, thresholds.auto],
    );
  } finally {
    await db.end();
  }
}

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  return page.getByRole('textbox', { name: 'Message' });
}

async function sendAndWait(page: Page, text: string, turns: number) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toHaveCount(turns, { timeout: 20_000 });
}

test('the ring warns at 60%, the card compacts at 80%, and the divider shows the summary', async ({
  page,
}) => {
  await startAt(ASKS_FIRST);
  await newChat(page);
  await sendAndWait(page, 'Plan the rollout #ctx75', 1);
  const ring = page.getByRole('button', { name: /Context window: 75% used/ });
  await expect(ring).toHaveAttribute('data-level', 'warm');
  await ring.click();
  await expect(page.getByRole('dialog', { name: 'Context window' })).toContainText(
    'Getting full. Spark asks about compacting at 80%',
  );
  await page.keyboard.press('Escape');

  await sendAndWait(page, 'Go deeper #ctx90', 2);
  await expect(page.getByRole('button', { name: /Context window: 90% used/ })).toHaveAttribute(
    'data-level',
    'hot',
  );

  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('What is next?');
  await input.press('Enter');
  const card = page.getByRole('group', { name: /This chat is almost full/ });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("The agent's context is 90% full (180K of 200K tokens).");
  await expect(card.getByRole('button')).toHaveText([
    'Compact now',
    'Start a fresh chat with a summary',
    /^Keep going \(\d+s\)$/,
  ]);
  await card.getByRole('button', { name: 'Compact now' }).click();
  await expect(page.locator('.mood', { hasText: 'done' })).toHaveCount(3, { timeout: 20_000 });

  const divider = page.getByRole('group', { name: 'Compacted' });
  await expect(divider).toContainText('180K → 12K tokens');
  const view = divider.getByRole('button', { name: 'View summary' });
  await view.click();
  await expect(divider.getByRole('button', { name: 'Hide summary' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(divider).toContainText('Compacted the conversation');
  await expect(page.getByRole('button', { name: /Context window: 6% used/ })).toBeVisible();
});

test('without /compact Spark writes the summary itself', async ({ page }) => {
  await startAt();
  await newChat(page);
  await sendAndWait(page, 'Plan the rollout #ctx92 #nocompact', 1);
  await sendAndWait(page, 'What is next?', 2);

  const divider = page.getByRole('group', { name: 'Compacted with a Spark summary' });
  await expect(divider).toContainText('184K →');
  await divider.getByRole('button', { name: 'View summary' }).click();
  await expect(divider.getByRole('heading', { name: 'Compacted chat summary' })).toBeVisible();
  await expect(divider).toContainText('Plan the rollout #ctx92 #nocompact');
});

test('a fresh chat with a summary links both ways', async ({ page }) => {
  await startAt(ASKS_FIRST);
  await newChat(page);
  await sendAndWait(page, 'Ledger fixes #ctx88', 1);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Carry on');
  await input.press('Enter');
  const card = page.getByRole('group', { name: /This chat is almost full/ });
  await card.getByRole('button', { name: 'Start a fresh chat with a summary' }).click();

  const continued = page.getByRole('group', { name: 'Continued in a fresh chat' });
  await expect(continued).toContainText('Ledger fixes #ctx88 (continued)', { timeout: 20_000 });
  await continued.getByRole('button', { name: 'Open the fresh chat' }).click();

  const seed = page.getByRole('group', { name: /Started from a summary of Ledger fixes/ });
  await expect(seed).toBeVisible();
  await expect(page.locator('.msg.me', { hasText: 'Carry on' })).toBeVisible();
  await seed.getByRole('button', { name: 'Open the earlier chat' }).click();
  await expect(page.getByRole('group', { name: 'Continued in a fresh chat' })).toBeVisible();
});

test('saved thresholds drive the ring, and with automatic compaction off Spark only asks', async ({
  page,
}) => {
  await startAt({ warn: 30, compact: 50, auto: false });
  await newChat(page);
  await sendAndWait(page, 'Sketch it #ctx40', 1);
  const ring = page.getByRole('button', { name: /Context window: 40% used/ });
  await expect(ring).toHaveAttribute('data-level', 'warm');
  await ring.click();
  await expect(page.getByRole('dialog', { name: 'Context window' })).toContainText(
    'Getting full. Spark asks about compacting at 50%',
  );
  await page.keyboard.press('Escape');

  await sendAndWait(page, 'More #ctx55', 2);
  await expect(page.getByRole('button', { name: /Context window: 55% used/ })).toHaveAttribute(
    'data-level',
    'hot',
  );
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('And then?');
  await input.press('Enter');
  const card = page.getByRole('group', { name: /This chat is almost full/ });
  await expect(card).toContainText('Automatic compaction is off, so Spark asks first.', {
    timeout: 20_000,
  });
  await card.getByRole('button', { name: /^Keep going/ }).click();
  await expect(page.getByText('Kept going; Spark asks again at 60%.')).toBeVisible();
  await expect(page.locator('.mood', { hasText: 'done' })).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByRole('group', { name: /^Compacted/ })).toHaveCount(0);
});
