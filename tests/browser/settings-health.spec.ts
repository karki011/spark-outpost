import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  acceptedOf,
  acceptedRecordPath,
  acceptedRecordText,
} from '../../apps/server/src/spark-rules/accepted.ts';
import { resetTestDatabase } from './database.ts';
import { SPARK_RULES_DIR, SPARK_RULES_FILE } from './stub-config.ts';
import { openSettingsTab } from './rail-menu.ts';

function writeBrokenRules() {
  const text = '{ broken';
  mkdirSync(SPARK_RULES_DIR, { recursive: true });
  writeFileSync(SPARK_RULES_FILE, text);
  writeFileSync(
    acceptedRecordPath(SPARK_RULES_FILE),
    acceptedRecordText(acceptedOf({ kind: 'text', text })),
  );
}

async function openHealth(page: Page) {
  await page.goto('/');
  await openSettingsTab(page, 'Health');
  return page.getByRole('dialog', { name: 'Health' });
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a clean profile says everything looks fine', async ({ page }) => {
  const health = await openHealth(page);
  const summary = health.getByRole('status').filter({ hasText: 'Everything looks fine' });
  await expect(summary).toBeVisible();
  await expect(health.getByRole('list')).toHaveCount(0);
});

test('a broken rules file shows as Broken and its fix opens Spark rules', async ({ page }) => {
  writeBrokenRules();
  const health = await openHealth(page);
  await expect(health.getByRole('status').first()).toHaveText(/1 thing to look at/);
  const rules = health.getByRole('list', { name: 'Spark rules' });
  const row = rules.getByRole('listitem').filter({ hasText: 'settings.json can’t be used' });
  await expect(row).toContainText('Broken');
  await expect(row).toContainText('recommended rules');
  const scan = await new AxeBuilder({ page }).include('.health-source').analyze();
  expect(scan.violations.map((violation) => violation.id)).toEqual([]);
  await row.getByRole('button', { name: 'Open Spark rules' }).click();
  const rulesPage = page.getByRole('dialog', { name: 'Spark rules' });
  await expect(rulesPage.getByRole('alert')).toContainText("settings.json can't be used.");
});
