import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openOutpost, post, say, seeded } from './outposts-kit.ts';

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('a pinned note shows in the Pinned line and can be unpinned', async ({ page }) => {
  await seeded(page);
  const main = await openOutpost(page);
  await page.getByRole('button', { name: 'Message destination' }).click();
  await page.getByRole('menuitemradio', { name: /^Post note/ }).click();
  await say(page, 'Orders ship on Friday.\nSecond line.');
  const note = post(page, 'Orders ship on Friday.');
  await expect(note).toBeVisible();
  await expect(main.getByRole('button', { name: /^Pinned/ })).toHaveCount(0);

  await note.getByRole('button', { name: 'Pin note' }).click();
  await expect(note.getByRole('button', { name: 'Unpin note' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const bar = main.getByRole('button', { name: 'Pinned · 1' });
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  await bar.click();
  await expect(main.getByRole('list', { name: 'Pinned notes' })).toContainText(
    'Orders ship on Friday.',
  );
  await expect(main.getByRole('list', { name: 'Pinned notes' })).not.toContainText('Second line.');

  await note.getByRole('button', { name: 'Unpin note' }).click();
  await expect(main.getByRole('button', { name: /^Pinned/ })).toHaveCount(0);
});
