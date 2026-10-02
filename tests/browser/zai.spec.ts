import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { REJECTED_KEY_MARKER } from './stub-config.ts';
import { openChats } from './navigation.ts';

const ZAI_KEY = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6.GlmTestTail';
const NOTE = 'Uses your Z.ai API key and Z.ai billing; never your Claude account.';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function openProviders(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  return page.getByRole('dialog', { name: 'AI providers' });
}

test('Z.ai connects with an API key, says who bills it, and runs a chat', async ({ page }) => {
  const providers = await openProviders(page);
  const tile = providers.locator('.ptile[data-prov="zai"]');
  const zai = providers.locator('.pconf[data-prov="zai"]');
  await expect(tile).toContainText('Z.ai (GLM)');
  await expect(tile).toContainText('by Z.ai');
  await expect(tile).toContainText('Connect with an API key');
  await expect(tile.locator('.plogo svg')).toHaveAttribute('aria-hidden', 'true');

  await tile.click();
  await expect(zai).toContainText(NOTE);
  await expect(zai.getByRole('tab')).toHaveCount(0);
  const keyPage = zai.getByRole('link', { name: 'Z.ai console (opens in a new tab)' });
  await expect(keyPage).toHaveAttribute('href', 'https://z.ai/manage-apikey/apikey-list');
  await expect(keyPage).toHaveAttribute('target', '_blank');
  await expect(keyPage).toHaveAttribute('rel', 'noopener noreferrer');

  const key = zai.getByLabel('Z.ai (GLM) API key');
  await key.fill(`sk-ant-api03-${'x'.repeat(24)}`);
  await expect(zai).toContainText(
    'This looks like an Anthropic key. Paste it under Claude instead.',
  );
  await expect(zai.getByRole('button', { name: 'Verify key' })).toBeDisabled();

  await key.fill(`${REJECTED_KEY_MARKER}-${ZAI_KEY}`);
  await zai.getByRole('button', { name: 'Verify key' }).click();
  await expect(zai).toContainText('Z.ai rejected this key (401 Unauthorized).');
  await expect(zai.locator('.pconf-head')).toContainText('Error');

  await key.fill(ZAI_KEY);
  await key.press('Enter');
  const details = zai.getByRole('region', { name: 'How to connect' });
  await expect(details).toContainText('Key…Tail');
  await expect(details).toContainText('Verified with Z.ai');
  await expect(zai).toContainText(NOTE);
  await expect(zai.locator('.pchip.ok')).toHaveText('Connected · API key');
  await expect(page.locator('body')).not.toContainText(ZAI_KEY);

  const results = await new AxeBuilder({ page })
    .include('.pconf[data-prov="zai"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await zai.getByRole('button', { name: 'Send test message' }).click();
  await expect(zai.getByRole('region', { name: 'Test' })).toContainText(
    /Test message answered in \d+\.\d s by glm-5\.3-flash/,
  );
  await expect(zai.getByRole('button', { name: 'Sign in again' })).toHaveCount(0);
  await expect(
    zai.getByRole('button', { name: 'Hold to remove the Z.ai (GLM) key' }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(tile).toBeFocused();
  await expect(tile).toContainText('Last test passed');
  const tiles = await new AxeBuilder({ page })
    .include('.ptiles-view')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(tiles.violations).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.getByRole('button', { name: /Model and effort/ }).click();
  await page.getByRole('tab', { name: 'Z.ai (GLM)' }).click();
  await expect(page.getByRole('button', { name: /Model and effort: GLM-5\.3/ })).toBeVisible();
  await page.keyboard.press('Escape');

  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Hello GLM');
  await input.press('Enter');
  await expect(page.getByText('This reply comes from the fake provider')).toBeVisible({
    timeout: 15_000,
  });
});
