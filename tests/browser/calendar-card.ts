import { expect, type Page } from '@playwright/test';

export const calendarCard = (page: Page) => page.locator('[data-connector="calendar"]');

export async function sourceMenu(page: Page, source: string, item: string): Promise<void> {
  const label = `Options for ${source}`;
  await calendarCard(page).getByRole('button', { name: label, exact: true }).click();
  const menu = page.getByRole('menu', { name: label });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item }).click();
}

export async function chooseCalendars(page: Page, source: string): Promise<void> {
  await sourceMenu(page, source, 'Choose calendars');
  await expect(
    calendarCard(page).getByRole('group', { name: 'Choose calendars' }).first(),
  ).toBeVisible();
}

export async function editCalendars(page: Page, source: string): Promise<void> {
  await sourceMenu(page, source, 'Agents can edit');
}

export async function disconnectSource(page: Page, source: string): Promise<void> {
  await sourceMenu(page, source, 'Disconnect…');
  const dialog = page.getByRole('alertdialog', { name: `Disconnect ${source}?` });
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(dialog).toBeHidden();
}
