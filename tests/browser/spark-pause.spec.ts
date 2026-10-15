import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { mainNav, navButton, openTouch, PHONE } from './responsive-kit.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const banner = (page: Page) => page.getByRole('status').filter({ hasText: 'Spark is paused' });

const SKINS = ['light', 'dark', 'graphite', 'contrast', 'void', 'apricot'];

test('pauses Spark from the rail with the keyboard and resumes it from the banner', async ({
  page,
}) => {
  await page.goto('/');
  await mainNav(page).waitFor();
  await expect(banner(page)).toHaveCount(0);

  const pause = page.getByRole('button', { name: 'Pause Spark' });
  await pause.focus();
  await page.keyboard.press('Enter');

  await expect(banner(page)).toContainText('Automatic work is held.');
  await expect(page.getByRole('button', { name: 'Resume Spark' })).toBeVisible();

  await page.reload();
  await expect(banner(page)).toBeVisible();

  await banner(page).getByRole('button', { name: 'Resume' }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause Spark' })).toBeVisible();
});

test('the banner takes the place of the new default notice until Spark is resumed', async ({
  page,
}) => {
  const db = openTestDb();
  try {
    await db.query('UPDATE profiles SET default_level_notice = true');
  } finally {
    await db.end();
  }
  const notice = page.getByRole('complementary', { name: 'Default for new chats changed' });
  await page.goto('/');
  await expect(notice).toBeVisible();

  await page.getByRole('button', { name: 'Pause Spark' }).click();
  await expect(banner(page)).toBeVisible();
  await expect(notice).toHaveCount(0);
  await banner(page).getByRole('button', { name: 'Resume' }).click();

  await expect(banner(page)).toHaveCount(0);
  await expect(notice).toBeVisible();
});

test('a phone pauses Spark from More and the Mac shows it at once', async ({ page, browser }) => {
  await page.goto('/');
  await mainNav(page).waitFor();
  const phone = await openTouch(browser, PHONE, 'home');

  await navButton(phone, 'More').click();
  await navButton(phone, 'Pause Spark').click();
  await expect(banner(phone)).toBeVisible();
  await expect(banner(page)).toBeVisible();

  await banner(page).getByRole('button', { name: 'Resume' }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(banner(phone)).toHaveCount(0);
  await navButton(phone, 'More').click();
  await expect(navButton(phone, 'Pause Spark')).toBeVisible();
  await phone.close();
});

test('the banner and its button keep their contrast in light and dark skins', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause Spark' }).click();
  await expect(banner(page)).toBeVisible();
  for (const skin of SKINS) {
    await page.evaluate((name) => (document.documentElement.dataset.skin = name), skin);
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== 'running'),
    );
    const results = await new AxeBuilder({ page })
      .include('.spark-paused')
      .withRules(['color-contrast'])
      .analyze();
    expect([skin, results.violations]).toEqual([skin, []]);
  }
});
