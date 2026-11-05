import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test('Spark settings save custom text and a local instruction file @packaged', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const root = mkdtempSync(path.join(tmpdir(), 'spark-instructions-browser-'));
  const file = path.join(root, 'instructions.md');
  writeFileSync(file, 'Check keyboard focus.');
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'dark'));
    await page.goto('/');
    const settings = page.getByRole('dialog', { name: 'Chats & autonomy' });
    const openChatsSettings = async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page
        .getByRole('dialog', { name: 'Profile & personality' })
        .getByRole('tab', { name: 'Chats & autonomy' })
        .click();
    };
    await openChatsSettings();
    await settings.getByLabel('Custom instructions', { exact: true }).fill('Keep changes small.');
    await settings.getByText('Use an instruction file', { exact: true }).click();
    await settings.getByLabel('Instructions file path').fill(file);
    const saved = page.waitForResponse(
      (response) => response.url().endsWith('/api/profile') && response.ok(),
    );
    await settings.getByRole('button', { name: 'Save instructions' }).click();
    expect((await saved).status()).toBe(200);
    await expect(settings.getByRole('button', { name: 'Save instructions' })).toBeDisabled();
    await page.reload();
    await openChatsSettings();
    await expect(settings.getByLabel('Custom instructions', { exact: true })).toHaveValue(
      'Keep changes small.',
    );
    await expect(settings.getByLabel('Instructions file path')).toHaveValue(file);
    await settings.getByLabel('Instructions file path').fill(path.join(root, 'missing.md'));
    await settings.getByRole('button', { name: 'Save instructions' }).click();
    await expect(settings.getByRole('alert')).toContainText('could not be read');
    const profile = (await (await page.request.get('/api/setup')).json()).profile;
    expect(profile.agentInstructionsFile).toBe(file);
    await settings.getByLabel('Instructions file path').fill(file);
    await expect(settings.getByRole('alert')).toHaveCount(0);
    rmSync(file);
    await page.reload();
    await openChatsSettings();
    await expect(settings.getByRole('alert')).toContainText('it was moved or deleted');
    await settings
      .getByRole('switch', { name: 'Record Terminal sessions like chats' })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.local/report/workflow-settings.png', fullPage: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
