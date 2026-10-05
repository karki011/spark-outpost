import { expect, test, type Page } from '@playwright/test';
import { POLICY_VERSION } from '../../apps/server/src/advisor/policy.ts';
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

test('shows what Jev suggested in the turn chip, with the rules comparison on focus', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, jev: true });
  await sendInNewChat(page, 'Fix the typo in the README heading');

  await expect(page.locator('.run-usage', { hasText: 'Jev:' })).toHaveCount(0);
  const chip = page.locator('.ai-head .cat-chip.advice');
  await expect(chip).toHaveText(/^Bug fix/);
  await expect(page.locator('.ai-head .ai-jev')).toHaveText('Jev: read it as Bug fix');
  await chip.focus();
  const tip = chip.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Jev: Bug fix');
  await expect(tip).toContainText('Category Bug fix');
  await expect(tip).toContainText('Rules ran: Claude');
  await expect(tip).toContainText(`policy ${POLICY_VERSION}`);

  await page.getByRole('button', { name: /Context window/ }).click();
  await expect(page.locator('.ctx-usage')).toContainText('Jev');
});

test('says Jev is not connected on the turn, and nothing else from Jev', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await sendInNewChat(page, 'Hello without Jev');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible();
  await expect(page.locator('.thread .ai-head .ai-jev')).toHaveText('Jev not connected');
  await expect(page.getByText(/Jev:|Jev failed|Jev answered/)).toHaveCount(0);
});
