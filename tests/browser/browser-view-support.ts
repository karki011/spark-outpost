import { expect, type Page } from '@playwright/test';
import { calls, withDesktopBrowser } from './desktop-browser.ts';

export const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });

export async function openBrowserView(page: Page) {
  await withDesktopBrowser(page);
  await page.goto('/');
  await rail(page).getByRole('button', { name: 'Browser' }).click();
  const side = page.getByRole('navigation', { name: 'Browser' });
  await expect(side).toBeVisible();
  return side;
}

export async function viewCommands(page: Page) {
  return (await calls(page, 'view-command')) as { profile: string; command: unknown }[];
}

export async function pushView(page: Page, tabs: unknown[], favorites: unknown[] = []) {
  await page.evaluate(
    ([tabsArg, favoritesArg]) =>
      (
        window as unknown as {
          browserViewPush: (p: string, t: unknown[], f: unknown[]) => void;
        }
      ).browserViewPush('personal', tabsArg as unknown[], favoritesArg as unknown[]),
    [tabs, favorites],
  );
}
