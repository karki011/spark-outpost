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

export async function pushView(
  page: Page,
  tabs: unknown[],
  favorites: unknown[] = [],
  profile: 'personal' | 'work' = 'personal',
  extra: Record<string, unknown> = {},
) {
  await page.evaluate(
    ([tabsArg, favoritesArg, profileArg, extraArg]) =>
      (
        window as unknown as {
          browserViewPush: (
            p: string,
            t: unknown[],
            f: unknown[],
            e: Record<string, unknown>,
          ) => void;
        }
      ).browserViewPush(
        profileArg as string,
        tabsArg as unknown[],
        favoritesArg as unknown[],
        extraArg as Record<string, unknown>,
      ),
    [tabs, favorites, profile, extra] as const,
  );
}
