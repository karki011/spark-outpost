import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
});

async function openModels(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Profile' }).getByRole('tab', { name: 'Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Models' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Models shows each provider’s cards, measured runs and what Jev reads', async ({ page }) => {
  const dialog = await openModels(page);
  const claude = dialog.getByRole('region', { name: 'Claude' });
  const codex = dialog.getByRole('region', { name: 'Codex' });
  await expect(dialog.getByRole('region', { name: 'Z.ai (GLM)' })).toContainText('not connected');

  const sonnet = claude.getByRole('listitem', { name: 'Sonnet 5', exact: true });
  await expect(sonnet).toContainText('mid tier');
  await expect(sonnet.getByRole('table', { name: 'Measured on our benchmark' })).toContainText(
    'fix alone · medium',
  );
  const fable = claude.getByRole('listitem', { name: 'Fable 5.1', exact: true });
  await expect(fable).toContainText('frontier tier');
  await expect(fable).toContainText('not offered');
  await expect(fable).toContainText('No benchmark runs yet');

  const sol = codex.getByRole('listitem', { name: '6 Sol', exact: true });
  await expect(sol).toContainText('default');
  await expect(sol.getByRole('table')).toContainText('anecdotal');

  const summary = sol.getByText('What Jev reads');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(sol.locator('.mc-jev code')).toHaveText(/^6 Sol: mid tier, fast, \$2\/\$10 per M/);
  await expect(sol.locator('.mc-jev')).toContainText('of 160 characters');
});

test('frontier models are allowed per provider from the keyboard and stay saved', async ({
  page,
}) => {
  const dialog = await openModels(page);
  const codexSwitch = dialog.getByRole('switch', { name: 'Allow frontier models for Codex' });
  const claudeSwitch = dialog.getByRole('switch', { name: 'Allow frontier models for Claude' });
  await expect(codexSwitch).not.toBeChecked();
  await expect(claudeSwitch).not.toBeChecked();
  await expect(codexSwitch).toHaveAccessibleDescription(/Lets Jev choose 6 Astra on Auto/);
  await expect(claudeSwitch).toHaveAccessibleDescription(/Lets Jev choose Fable 5\.1 on Auto/);

  await codexSwitch.focus();
  await page.keyboard.press('Space');
  await expect(codexSwitch).toBeChecked();

  await page.reload();
  const again = await openModels(page);
  await expect(
    again.getByRole('switch', { name: 'Allow frontier models for Codex' }),
  ).toBeChecked();
  await expect(
    again.getByRole('switch', { name: 'Allow frontier models for Claude' }),
  ).not.toBeChecked();
});
