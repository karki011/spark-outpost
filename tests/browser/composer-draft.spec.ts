import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const FIRST = 'Plan the billing migration';
const SECOND = 'Review the onboarding copy';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGMwObwYiBggFAArKgZp8w3CnwAAAABJRU5ErkJggg==';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: FIRST }, { title: SECOND }]);
});

const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });

async function openChat(page: Page, title: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Chats' }).getByText(title).click();
  await expect(page.locator('.chat-title')).toHaveText(title);
  await expect(message(page)).toBeVisible();
}

async function reopen(page: Page, title: string): Promise<void> {
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Chats/ })
    .click();
  await openChat(page, title);
}

test('a typed draft comes back after a reload and stays in its own chat', async ({ page }) => {
  await openChats(page);
  await openChat(page, FIRST);
  await message(page).fill('Draft for the billing chat');

  await openChat(page, SECOND);
  await expect(message(page)).toHaveValue('');

  await reopen(page, SECOND);
  await expect(message(page)).toHaveValue('');
  await openChat(page, FIRST);
  await expect(message(page)).toHaveValue('Draft for the billing chat');

  await reopen(page, FIRST);
  await expect(message(page)).toHaveValue('Draft for the billing chat');
});

test('sending clears the saved draft so a reload shows an empty composer', async ({ page }) => {
  await openChats(page);
  await openChat(page, FIRST);
  const text = 'Send this one now';
  await message(page).fill(text);
  await message(page).press('Enter');
  await expect(page.locator('.md', { hasText: `You wrote: "${text}"` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(message(page)).toHaveValue('');

  await reopen(page, FIRST);
  await expect(message(page)).toHaveValue('');
});

test('attachments are not restored with the draft', async ({ page }) => {
  await openChats(page);
  await openChat(page, FIRST);
  await message(page).fill('Look at this picture');
  await page.getByRole('button', { name: 'Add files and context' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Upload a file' }).click();
  await (
    await chooser
  ).setFiles([{ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64') }]);
  const chips = page.getByRole('group', { name: 'Attachments' }).first();
  await expect(chips.getByRole('img', { name: 'a.png' })).toBeVisible();

  await reopen(page, FIRST);
  await expect(message(page)).toHaveValue('Look at this picture');
  await expect(page.getByRole('group', { name: 'Attachments' })).toHaveCount(0);
});
