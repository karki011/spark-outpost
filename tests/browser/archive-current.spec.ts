import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Open chat' }, { title: 'Other chat' }]);
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const header = (page: Page) => page.getByRole('main').getByRole('heading', { level: 1 });
const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const toast = (page: Page, title: string) =>
  sidebar(page)
    .getByRole('status')
    .filter({ hasText: `Archived ${title}` });

async function archive(page: Page, title: string) {
  await sidebar(page).getByRole('listitem').filter({ hasText: title }).hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for ${title}` })
    .click();
  await page
    .getByRole('menu', { name: `Options for ${title}` })
    .getByRole('menuitem', { name: 'Archive' })
    .click();
}

async function openChat(page: Page, title: string) {
  await openChats(page);
  await sidebar(page).getByRole('listitem').filter({ hasText: title }).click();
  await expect(header(page)).toHaveText(title);
}

test('archiving the open chat goes to a new chat, and Undo brings it back', async ({ page }) => {
  await openChat(page, 'Open chat');
  await archive(page, 'Open chat');
  await expect(header(page)).not.toHaveText(/Open chat|Other chat/);
  await expect(message(page)).toHaveValue('');

  await toast(page, 'Open chat').getByRole('button', { name: 'Undo' }).click();
  await expect(header(page)).toHaveText('Open chat');
  await expect(sidebar(page).getByRole('listitem').filter({ hasText: 'Open chat' })).toBeVisible();
});

test('Undo keeps a new chat the user has started typing in', async ({ page }) => {
  await openChat(page, 'Open chat');
  await archive(page, 'Open chat');
  await expect(header(page)).not.toHaveText(/Open chat|Other chat/);
  await toast(page, 'Open chat').hover();
  await message(page).fill('Something new');

  await toast(page, 'Open chat').getByRole('button', { name: 'Undo' }).click();
  await expect(sidebar(page).getByRole('listitem').filter({ hasText: 'Open chat' })).toBeVisible();
  await expect(message(page)).toHaveValue('Something new');
  await expect(header(page)).not.toHaveText('Open chat');
});

test('archiving another chat leaves the open chat on screen', async ({ page }) => {
  await openChat(page, 'Open chat');
  await archive(page, 'Other chat');
  await expect(toast(page, 'Other chat')).toBeVisible();
  await expect(header(page)).toHaveText('Open chat');
  await expect(sidebar(page).getByRole('listitem').filter({ hasText: 'Other chat' })).toHaveCount(
    0,
  );
});
