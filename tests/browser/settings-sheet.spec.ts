import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

function focusInside(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const panel = document.querySelector('.set-panel');
    return panel !== null && panel.contains(document.activeElement);
  });
}

test('Tab and Shift+Tab stay inside the Settings sheet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Profile & personality' });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close settings' });
  await expect(close).toBeFocused();

  const stops = await dialog.evaluate(
    (panel) =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0).length,
  );
  for (let step = 0; step < stops + 3; step += 1) {
    await page.keyboard.press('Tab');
    expect(await focusInside(page)).toBe(true);
  }

  await dialog.getByLabel('Search settings').focus();
  for (let step = 0; step < stops + 3; step += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInside(page)).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a settings link opens the sheet on that section and closing it leaves the link', async ({
  page,
}) => {
  await page.goto('/#/settings/notifications');
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close settings' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/settings/);

  await page.evaluate(() => {
    window.location.hash = '#/settings/chats';
  });
  await expect(page.getByRole('dialog', { name: 'Chats & autonomy' })).toBeVisible();
});
