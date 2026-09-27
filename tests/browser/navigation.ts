import type { Page } from '@playwright/test';

export async function openChats(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Chats/ })
    .click();
}
