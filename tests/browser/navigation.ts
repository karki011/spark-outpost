import type { Page } from '@playwright/test';

export async function openChats(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Chats/ })
    .click();
}

export async function chooseSessionType(page: Page, type: 'Chat' | 'Terminal'): Promise<void> {
  await page
    .locator('.comp-foot')
    .getByRole('button', { name: /^Session type: / })
    .click();
  await page
    .getByRole('menu', { name: 'Session type' })
    .getByRole('menuitemradio', { name: new RegExp(`^${type}`) })
    .click();
}
