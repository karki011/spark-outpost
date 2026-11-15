import type { Page } from '@playwright/test';

export async function openRailMenu(page: Page, item: string | RegExp): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Main' });
  const more = nav.getByRole('button', { name: /^More/ });
  await more.waitFor();
  const direct = nav.getByRole('button', { name: item, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await more.click();
  await page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: item }).click();
}

export const clickSettings = (page: Page) => openRailMenu(page, 'Settings…');

export async function openSettingsTab(page: Page, tab: string): Promise<void> {
  await clickSettings(page);
  await page.getByRole('tab', { name: tab }).click();
}
