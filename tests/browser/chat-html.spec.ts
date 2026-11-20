import { expect, test } from '@playwright/test';
import { axeInEveryTheme } from './connector-cards.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const REPORT = [
  'Review of the landing page.',
  '',
  '<details><summary>[High] <b>SHOULD</b>: The Book Demo button has no label</summary>',
  '',
  '**Where:** `Hero.tsx:42`',
  '',
  '- Add an `aria-label`.',
  '',
  '</details>',
  '',
  '<details><summary>[Low] <b>COULD</b>: Tighten copy</summary>',
  '',
  'Press <kbd>⌘</kbd><kbd>K</kbd> to search.<br>Second line.',
  '',
  '<script>window.hacked = true</script><img src="https://track.example/p.gif" onerror="window.hacked = true">',
  '',
  '</details>',
  '',
  'Done.',
].join('\n');

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return (await db.query<{ id: string }>(text, values)).rows;
  } finally {
    await db.end();
  }
}

async function seedReport() {
  const [chatId] = await seedChats([
    { title: 'Landing page review', run: { status: 'succeeded' } },
  ]);
  const [run] = await sql(
    `UPDATE runs SET started_at = now() - interval '20 seconds', finished_at = now()
     WHERE conversation_id = $1 RETURNING id`,
    [chatId],
  );
  await sql(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     VALUES (gen_random_uuid(), $1, 'assistant', $2, $3)`,
    [chatId, REPORT, run!.id],
  );
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('an agent reply shows HTML folds collapsed and opens them from the keyboard', async ({
  page,
}) => {
  test.slow();
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.setViewportSize({ width: 1400, height: 900 });
  await seedReport();
  await openChats(page);

  const reply = page.locator('.msg.ai .md').last();
  const folds = reply.locator('details');
  await expect(folds).toHaveCount(2);
  await expect(reply).not.toContainText('<details>');
  await expect(reply).not.toContainText('<b>');
  await expect(folds.nth(0).locator('summary b')).toHaveText('SHOULD');
  await expect(folds.nth(0)).not.toHaveAttribute('open');
  await expect(folds.nth(0).getByText('Where:')).toBeHidden();

  const summary = folds.nth(0).locator('summary');
  await folds.nth(1).locator('summary').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(summary).toBeFocused();
  const outline = await summary.evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe('none');
  const box = (await summary.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(28);
  const size = await summary.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(size).toBeGreaterThanOrEqual(12);

  await page.keyboard.press('Enter');
  await expect(folds.nth(0)).toHaveAttribute('open');
  await expect(folds.nth(0).getByText('Where:')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(folds.nth(0)).not.toHaveAttribute('open');

  await page.keyboard.press('Tab');
  await expect(folds.nth(1).locator('summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(folds.nth(1).locator('kbd')).toHaveText(['⌘', 'K']);
  await expect(folds.nth(1).locator('script, img')).toHaveCount(0);
  expect(await page.evaluate(() => 'hacked' in window)).toBe(false);
  expect(requested.filter((url) => url.includes('track.example'))).toEqual([]);

  await axeInEveryTheme(page, '.msg.ai .md');
});
