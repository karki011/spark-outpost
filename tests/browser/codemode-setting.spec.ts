import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test('Code Mode starts on and keeps the user’s choice after reload', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page
      .getByRole('dialog', { name: 'Profile & personality' })
      .getByRole('tab', { name: 'Chats & autonomy' })
      .click();
  };
  await openSettings();
  const toggle = page
    .getByRole('dialog', { name: 'Chats & autonomy' })
    .getByRole('switch', { name: 'Code Mode', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => (await (await page.request.get('/api/setup')).json()).profile.codeMode)
    .toBe(false);
  await page.reload();
  await openSettings();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect
    .poll(async () => (await (await page.request.get('/api/setup')).json()).profile.codeMode)
    .toBe(true);
});
