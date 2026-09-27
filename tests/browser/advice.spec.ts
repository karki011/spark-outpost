import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

async function sendInNewChat(page: Page, text: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(page.locator('.md', { hasText: `You wrote: "${text}"` })).toBeVisible({
    timeout: 15_000,
  });
}

test('shows what Jev suggested on the turn, with the rules comparison on focus', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, jev: true });
  await sendInNewChat(page, 'Fix the typo in the README heading');

  const line = page.locator('.run-usage', { hasText: 'Jev:' });
  await expect(line).toHaveText(/^Jev: Bug fix/);
  await line.focus();
  const tip = line.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Category Bug fix');
  await expect(tip).toContainText('Rules ran: Claude');
  await expect(tip).toContainText('policy cascade-1');

  await page.getByRole('button', { name: /Context window/ }).click();
  await expect(page.locator('.ctx-usage')).toContainText('Jev');
});

test('shows nothing from Jev when Jev is not connected', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await sendInNewChat(page, 'Hello without Jev');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible();
  await expect(page.getByText(/Jev:|Jev unavailable/)).toHaveCount(0);
});
