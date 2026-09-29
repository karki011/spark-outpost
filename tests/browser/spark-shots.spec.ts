import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

test.use({ deviceScaleFactor: 2 });

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

  const blobs = {
    spark: 'Spark',
    'spend-cap': 'Spend cap per task',
    'morning-brief': 'Morning brief',
  };
  for (const [file, name] of Object.entries(blobs)) {
    const toggle = spark.getByRole('switch', { name, exact: true });
    const row = spark
      .locator('.set-row')
      .filter({ has: page.getByRole('switch', { name, exact: true }) });
    for (let flip = 0; flip < 2; flip += 1) {
      const state = (await toggle.getAttribute('aria-checked')) === 'true' ? 'on' : 'off';
      for (const theme of ['light', 'graphite']) {
        await useTheme(page, theme);
        await row.screenshot({ path: path.join(SHOTS, `blob-${file}-${state}-${theme}.png`) });
      }
      await toggle.click();
      await page.waitForTimeout(1200);
    }
  }

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
