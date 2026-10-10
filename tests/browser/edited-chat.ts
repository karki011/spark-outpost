import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { pickPermission } from './permissions-kit.ts';
import { openChats } from './navigation.ts';
import { turnDone } from './project-chat-kit.ts';

export async function askForEdit(page: Page, root: string): Promise<void> {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(root)}`) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const picker = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await expect(picker).toBeVisible();
  await pickPermission(page, 'Ask before edits');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Add a line to the notes #edit #plan');
  await input.press('Enter');
  await expect(allowEdit(page)).toBeVisible({ timeout: 15_000 });
}

export function allowEdit(page: Page): Locator {
  return page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true });
}

export async function editedChat(page: Page, root: string): Promise<void> {
  await askForEdit(page, root);
  await allowEdit(page).click();
  await expect(page.locator('.md', { hasText: 'fake-edit=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  await turnDone(page, 15_000);
}
