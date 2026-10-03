import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test('the app shows while the web font host does not answer', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  let asked = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/fonts\.googleapis\.com/, async (route) => {
    asked += 1;
    await held;
    await route.abort();
  });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  expect(asked).toBeGreaterThan(0);
  release();
});
