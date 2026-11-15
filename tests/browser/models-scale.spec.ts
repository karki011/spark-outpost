import { expect, test, type Page } from '@playwright/test';
import type { ModelCardsResponse } from '../../packages/contracts/src/model-cards.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
});

async function openTab(page: Page, tab: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: tab === 'Models' ? 'AI providers' : tab }).click();
  if (tab === 'Models') await page.getByRole('radio', { name: 'Models' }).click();
  const dialog = page.getByRole('dialog', { name: tab === 'Models' ? 'AI providers' : tab });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a long list of models without a card shows five and a count', async ({ page }) => {
  await page.route('**/api/model-cards', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as ModelCardsResponse;
    const codex = body.providers.find((view) => view.provider.provider === 'codex')!;
    codex.uncardedModels = Array.from({ length: 24 }, (_, index) => ({
      id: `preview-${index + 1}`,
      label: `Preview ${index + 1}`,
    }));
    await route.fulfill({ response, json: body });
  });
  const dialog = await openTab(page, 'Models');
  const codex = dialog.getByRole('region', { name: 'Codex' });
  const uncarded = codex.locator('tbody').last().locator('.mc-row');
  await expect(uncarded).toHaveCount(5);
  await expect(codex.getByRole('note')).toContainText('No card for 24 models');
  const more = codex.getByRole('button', { name: 'Show 19 more' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(uncarded).toHaveCount(24);
  const fewer = codex.getByRole('button', { name: 'Show fewer' });
  await expect(fewer).toBeFocused();
  await fewer.press('Enter');
  await expect(uncarded).toHaveCount(5);
});

test('All folds a provider that is not connected until it is opened', async ({ page }) => {
  const dialog = await openTab(page, 'Models');
  const zai = dialog.getByRole('region', { name: 'Z.ai (GLM)' });
  await expect(zai.getByRole('table')).toHaveCount(0);
  await zai.getByRole('button', { name: 'Show 2 models' }).click();
  await expect(zai.getByRole('table', { name: /^Z\.ai \(GLM\) models/ })).toBeVisible();
  await zai.getByRole('button', { name: 'Hide models' }).click();
  await expect(zai.getByRole('table')).toHaveCount(0);

  await dialog.getByRole('radio', { name: /^Z\.ai/ }).click();
  await expect(zai.getByRole('table')).toBeVisible();
  await expect(zai.getByRole('button', { name: /models$/ })).toHaveCount(0);
});

test('connected providers come first and the rest sit under Not connected', async ({ page }) => {
  const dialog = await openTab(page, 'AI providers');
  const connected = dialog.getByRole('list', { name: 'AI providers' }).locator('.ptile');
  await expect(connected).toHaveCount(2);
  await expect(connected.nth(0)).toHaveAttribute('data-prov', 'claude');
  await expect(connected.nth(1)).toHaveAttribute('data-prov', 'codex');
  await expect(dialog.getByRole('heading', { name: 'Not connected' })).toBeVisible();
  const rest = dialog.getByRole('list', { name: 'Not connected providers' }).locator('.ptile');
  await expect(rest).toHaveCount(2);
  await expect(rest.nth(0)).toHaveAttribute('data-prov', 'zai');
  await expect(rest.nth(1)).toHaveAttribute('data-prov', 'custom');
});
