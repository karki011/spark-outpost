import { expect, type Locator, type Page } from '@playwright/test';

export const ADD_FOLDER = /^Add folder…/;
export const CLONE_REPO = /^Clone a repository…/;

export function plainFolderNotice(page: Page, name: string) {
  return page.getByRole('dialog', { name: `Added ${name}` });
}

export async function keepPlainFolder(page: Page, name: string): Promise<void> {
  const notice = plainFolderNotice(page, name);
  await expect(notice.getByRole('button', { name: 'Done' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(notice).toHaveCount(0);
}

export async function browseTo(dialog: Locator, target: string): Promise<void> {
  await dialog.getByRole('navigation', { name: 'Folder path' }).getByRole('button').first().click();
  for (const segment of target.split('/').filter(Boolean)) {
    await dialog
      .getByRole('list', { name: 'Folders' })
      .getByRole('button', { name: segment, exact: true })
      .click();
    await expect(dialog.locator('.fdlg-path')).toHaveText(new RegExp(`/${segment}$`));
  }
}
