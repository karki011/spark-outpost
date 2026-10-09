import { expect, type Locator, type Page } from '@playwright/test';

export type HeaderPane = 'Agent TV' | 'Browser' | 'Terminal';

export const chatMenuButton = (page: Page): Locator =>
  page.locator('.head-r').getByRole('button', { name: /^Chat actions\./ });

export const chatMenuDot = (page: Page): Locator => chatMenuButton(page).locator('.head-menu-dot');

export const headerPaneItem = (page: Page, pane: HeaderPane): Locator =>
  page.getByRole('menuitemcheckbox', { name: pane });

export async function openChatMenu(page: Page): Promise<Locator> {
  const menu = page.locator('.head-r').getByRole('menu');
  if (!(await menu.isVisible())) await chatMenuButton(page).click();
  await expect(menu).toBeVisible();
  return menu;
}

export async function closeChatMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.head-r').getByRole('menu')).toHaveCount(0);
}

export async function toggleHeaderPane(page: Page, pane: HeaderPane): Promise<void> {
  await openChatMenu(page);
  await headerPaneItem(page, pane).click();
}

export async function expectHeaderPane(page: Page, pane: HeaderPane, open: boolean): Promise<void> {
  await openChatMenu(page);
  await expect(headerPaneItem(page, pane)).toHaveAttribute('aria-checked', String(open));
  await closeChatMenu(page);
}

export async function expectNoHeaderPane(page: Page, pane: HeaderPane): Promise<void> {
  await openChatMenu(page);
  await expect(headerPaneItem(page, pane)).toHaveCount(0);
  await closeChatMenu(page);
}
