import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('Cancel and Esc close the feedback comment without saving it', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Rate this');
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });

  const feedback = page.getByRole('group', { name: 'How did it go?' });
  const good = feedback.getByRole('button', { name: 'Good result' });
  await good.click();
  await expect(feedback.getByRole('status')).toHaveText('Saved');
  const note = feedback.getByRole('textbox', { name: 'Comment (optional)' });

  await feedback.getByRole('button', { name: 'Add a comment' }).click();
  await note.fill('Not saved');
  await feedback.getByRole('button', { name: 'Cancel' }).click();
  await expect(note).toBeHidden();
  await expect(good).toBeFocused();
  await expect(good).toHaveAttribute('aria-pressed', 'true');

  await feedback.getByRole('button', { name: 'Add a comment' }).click();
  await expect(note).toHaveValue('');
  await note.fill('Also not saved');
  await note.press('Escape');
  await expect(note).toBeHidden();
  await expect(good).toBeFocused();

  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Rate this').click();
  const again = page.getByRole('group', { name: 'How did it go?' });
  await expect(again.getByRole('button', { name: 'Good result' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(again.getByRole('textbox', { name: 'Comment (optional)' })).toBeHidden();
});
