import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

async function useTheme(page: Page, theme: string) {
  await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

test('Spark screenshots', async ({ page }) => {
  test.skip(!SHOTS, 'Set SPARK_SHOTS to a folder to write the screenshots.');
  test.setTimeout(120_000);
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const spark = page.getByRole('dialog', { name: 'Spark' });
  await spark.getByLabel('What should Spark call you?', { exact: true }).fill('Sam Rivera');
  await expect(spark.locator('.spark-preview')).toContainText('Hi Sam');
  const panel = page.locator('.set-panel');
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    await panel.screenshot({ path: path.join(SHOTS, `spark-settings-${theme}.png`) });
  }

  await useTheme(page, 'light');
  const team = spark.getByRole('switch', { name: 'Work like a team' });
  const row = spark
    .locator('.set-row')
    .filter({ has: page.getByRole('switch', { name: 'Work like a team' }) });
  await row.screenshot({ path: path.join(SHOTS, 'blob-toggle-on-light.png') });
  await team.click();
  await page.waitForTimeout(900);
  await row.screenshot({ path: path.join(SHOTS, 'blob-toggle-off-light.png') });
  await useTheme(page, 'graphite');
  await row.screenshot({ path: path.join(SHOTS, 'blob-toggle-off-graphite.png') });
  await team.click();
  await page.waitForTimeout(900);
  await row.screenshot({ path: path.join(SHOTS, 'blob-toggle-on-graphite.png') });

  await resetTestDatabase({ onboarded: false });
  await page.goto('/');
  await useTheme(page, 'light');
  const onb = page.locator('.onb');
  await onb.getByLabel('What should Spark call you?', { exact: true }).fill('Sam Rivera');
  await onb
    .getByRole('radiogroup', { name: 'Personality' })
    .getByRole('radio', { name: 'Playful' })
    .click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'onboarding-meet-spark-light.png') });
  await useTheme(page, 'graphite');
  await page.screenshot({ path: path.join(SHOTS, 'onboarding-meet-spark-graphite.png') });
});
