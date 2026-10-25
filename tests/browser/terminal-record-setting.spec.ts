import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test('Record Terminal sessions like chats starts on and stays as the user leaves it', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Chats & autonomy' })
    .click();
  const settings = page.getByRole('dialog', { name: 'Chats & autonomy' });
  const toggle = settings.getByRole('switch', { name: 'Record Terminal sessions like chats' });
  await expect(toggle).toBeChecked();
  await expect(
    settings.getByText('New Claude turns keep commands, replies, changed files and an audit.'),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await toggle.focus();
  await page.keyboard.press('Space');
  await saved;
  await expect(toggle).not.toBeChecked();
  await expect(
    settings.getByText('Terminal sessions keep state, tool names and times, tokens and cost.'),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Chats & autonomy' })
    .click();
  await expect(toggle).not.toBeChecked();
  const profile = (await (await page.request.get('/api/setup')).json()).profile;
  expect(profile.terminalRecordLikeChat).toBe(false);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect
    .poll(async () => (await (await page.request.get('/api/setup')).json()).profile)
    .toMatchObject({ terminalRecordLikeChat: true });
});
