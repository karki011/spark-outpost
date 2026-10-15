import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test('Record Terminal sessions like chats starts off and stays as the user leaves it', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Spark' });
  const toggle = settings.getByRole('switch', { name: 'Record Terminal sessions like chats' });
  await expect(toggle).not.toBeChecked();
  await expect(
    settings.getByText('Terminal sessions keep state, tool names and times, tokens and cost.'),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await toggle.focus();
  await page.keyboard.press('Space');
  await saved;
  await expect(toggle).toBeChecked();
  await expect(
    settings.getByText('New Claude turns keep commands, replies, changed files and an audit.'),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(toggle).toBeChecked();
  const profile = (await (await page.request.get('/api/setup')).json()).profile;
  expect(profile.terminalRecordLikeChat).toBe(true);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => (await (await page.request.get('/api/setup')).json()).profile)
    .toMatchObject({ terminalRecordLikeChat: false });
});
