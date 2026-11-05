import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('Start fresh closes the stored agent session from the chat menu', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Chat actions' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Agent TV' })).toBeFocused();
  const fresh = page.getByRole('menuitem', { name: 'Start fresh' });
  await expect(async () => {
    await page.keyboard.press('ArrowDown');
    await expect(fresh).toBeFocused({ timeout: 250 });
  }).toPass();
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith('/fresh-session') && candidate.request().method() === 'POST',
  );
  await page.keyboard.press('Enter');
  expect((await response).status()).toBe(200);
  await expect(fresh).toBeHidden();
  await expect(page.getByRole('button', { name: 'Chat actions' })).toBeFocused();
});
