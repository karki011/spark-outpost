import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('settings opens from the sidebar and lets a CLI provider sign in again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Profile' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Name')).toHaveValue('Test User');

  await dialog.getByRole('tab', { name: /AI providers/ }).click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const claude = providers.locator('.pcard').filter({ hasText: 'Claude' });
  await claude.locator('.pc-head').click();
  await claude.getByRole('button', { name: 'More Claude actions' }).click();
  await claude.getByRole('menuitem', { name: /Sign in again/ }).click();
  const terminal = claude.getByRole('region', { name: 'Terminal' });
  await expect(terminal).toContainText('Sign in to Claude');
  await expect(terminal.locator('.xterm-accessibility')).toContainText('claude auth login', {
    timeout: 15_000,
  });
  await expect(terminal.getByRole('button', { name: 'Run it' })).toBeEnabled();
  await expect(claude.getByRole('tab', { name: 'API key' })).toHaveCount(0);
  await claude.getByRole('button', { name: 'Cancel' }).click();
  await expect(claude.locator('.xterm')).toHaveCount(0);

  await providers.getByRole('tab', { name: 'Appearance' }).click();
  await expect(page.getByRole('dialog', { name: 'Appearance' }).locator('.tcard')).toHaveCount(7);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toHaveCount(0);
});

test('profile name changes save from settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const name = page.getByRole('dialog', { name: 'Profile' }).getByLabel('Name');
  await name.fill('Hazel Moss');
  await expect(page.getByText('Changes save automatically.')).toBeVisible();
  const profile = page.getByRole('navigation', { name: 'Main' }).getByRole('button', {
    name: 'Your profile, Hazel Moss',
  });
  await expect(profile).toBeVisible();
  await page.reload();
  await expect(profile).toBeVisible();
});

test('settings shows usage per provider', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Count my tokens');
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Profile' }).getByRole('tab', { name: 'Usage' }).click();
  const dialog = page.getByRole('dialog', { name: 'Usage' });
  const claude = dialog.getByRole('listitem', { name: 'Claude' });
  await expect(claude).toContainText('$0.004');
  await expect(claude).toContainText('1 reply · 1.2K tokens (900 in, 300 out)');
  await dialog.getByRole('radio', { name: 'All time' }).click();
  await expect(claude).toContainText('$0.004');
  await expect(dialog).toContainText('Claude reports its cost');
});
