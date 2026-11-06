import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { expandSection } from './provider-screen.ts';
import { resetTestDatabase } from './database.ts';
import { REJECTED_KEY_MARKER, X_API_KEY_MODEL } from './stub-config.ts';
import { STUB_URL } from './ticket-seed.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';

const KEY = 'gateway-test-key-0123456789.EndpointTail';
const BASE_URL = `${STUB_URL}/custom`;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function openProviders(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  return page.getByRole('dialog', { name: 'AI providers' });
}

test('a custom endpoint connects with an address and model, then answers a test', async ({
  page,
}) => {
  const providers = await openProviders(page);
  const tile = providers.locator('.ptile[data-prov="custom"]');
  const custom = providers.locator('.pconf[data-prov="custom"]');
  await expect(tile).toContainText('Custom endpoint');
  await expect(tile).toContainText('Connect with a server address and model');
  await tile.click();
  await expect(custom).toContainText('must speak the Anthropic Messages API');
  await expect(custom.getByRole('tab')).toHaveCount(0);

  const address = custom.getByLabel('Server address');
  const model = custom.getByLabel('Model', { exact: true });
  const key = custom.getByLabel('API key (optional)');
  const testButton = custom.getByRole('button', { name: 'Test connection' });
  await expect(testButton).toBeDisabled();

  await address.fill('http://192.168.1.20:11434');
  await model.fill('qwen3-coder');
  await expect(custom).toContainText('http:// works only for localhost');
  await expect(testButton).toBeDisabled();

  await address.fill(`${BASE_URL}/v1`);
  await expect(custom).toContainText('Leave out /v1');
  await expect(testButton).toBeDisabled();

  await address.fill(BASE_URL);
  await model.fill('missing-model');
  await testButton.click();
  await expect(custom).toContainText('Nothing answered at', { timeout: 20_000 });
  await expect(custom).toContainText('The server said: model not found');

  await model.fill('qwen3-coder');
  const keyHeader = custom.getByRole('radiogroup', { name: 'Send the key as' });
  await expect(keyHeader).toHaveCount(0);
  await key.fill(`${REJECTED_KEY_MARKER}-${KEY}`);
  await expect(keyHeader.getByRole('radio', { name: 'Authorization: Bearer' })).toBeChecked();
  await testButton.click();
  await expect(custom).toContainText('The endpoint refused the request (401). Check the API key.');

  await key.fill(KEY);
  await key.press('Enter');
  const details = custom.getByRole('region', { name: 'How to connect' });
  await expect(details).toContainText(BASE_URL);
  await expect(details).toContainText('qwen3-coder');
  await expect(details).toContainText('API key in your keychain');
  await expect(custom.locator('.pchip.ok')).toHaveText('Connected · Endpoint');
  await expect(page.locator('body')).not.toContainText(KEY);

  for (const name of ['How to connect', 'Test', 'Danger zone']) await expandSection(custom, name);
  await animationsSettled(page);
  const results = await new AxeBuilder({ page })
    .include('.pconf[data-prov="custom"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await custom.getByRole('button', { name: 'Send test message' }).click();
  await expect(custom.getByRole('region', { name: 'Test' })).toContainText(
    /Test message answered in \d+\.\d s by qwen3-coder/,
  );

  await page.keyboard.press('Escape');
  await expect(tile).toBeFocused();
  await expect(tile).toContainText('Connected · Endpoint');
  await animationsSettled(page);
  const tiles = await new AxeBuilder({ page })
    .include('.ptiles-view')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(tiles.violations).toEqual([]);
  await tile.click();

  await custom.getByRole('button', { name: 'Change endpoint' }).click();
  await expect(custom.getByLabel('Server address')).toHaveValue(BASE_URL);
  await expect(custom.getByLabel('Model', { exact: true })).toHaveValue('qwen3-coder');
  await expect(custom.getByLabel('API key (optional)')).toHaveValue('');
  await custom.getByLabel('Fast model (optional)').fill('qwen3-small');
  await custom.getByRole('button', { name: 'Test connection' }).click();
  await expect(details).toContainText('qwen3-coder, qwen3-small');
  await expect(details).toContainText('No API key');
});

test('a custom endpoint can send its key in the x-api-key header', async ({ page }) => {
  const providers = await openProviders(page);
  await providers.locator('.ptile[data-prov="custom"]').click();
  const custom = providers.locator('.pconf[data-prov="custom"]');
  await custom.getByLabel('Server address').fill(BASE_URL);
  await custom.getByLabel('Model', { exact: true }).fill(X_API_KEY_MODEL);
  const key = custom.getByLabel('API key (optional)');
  await key.fill(KEY);
  const keyHeader = custom.getByRole('radiogroup', { name: 'Send the key as' });
  await custom.getByRole('button', { name: 'Test connection' }).click();
  await expect(custom).toContainText('The server said: send the key in x-api-key');

  const xApiKey = keyHeader.getByRole('radio', { name: 'x-api-key' });
  await keyHeader.getByRole('radio', { name: 'Authorization: Bearer' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(xApiKey).toBeChecked();
  await expect(xApiKey).toBeFocused();
  await key.press('Enter');
  const details = custom.getByRole('region', { name: 'How to connect' });
  await expect(details).toContainText('API key in your keychain, sent as x-api-key');
  await expect(page.locator('body')).not.toContainText(KEY);

  await expandSection(custom, 'Test');
  await custom.getByRole('button', { name: 'Send test message' }).click();
  await expect(custom.getByRole('region', { name: 'Test' })).toContainText(
    new RegExp(`Test message answered in \\d+\\.\\d s by ${X_API_KEY_MODEL}`),
  );

  await expandSection(custom, 'How to connect');
  await custom.getByRole('button', { name: 'Change endpoint' }).click();
  await expect(keyHeader).toHaveCount(0);
  await custom.getByLabel('API key (optional)').fill(KEY);
  await expect(keyHeader.getByRole('radio', { name: 'x-api-key' })).toBeChecked();
  await animationsSettled(page);
  const results = await new AxeBuilder({ page })
    .include('.pconf[data-prov="custom"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
