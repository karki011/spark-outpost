import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('AI providers asks the user to allow keychain access while macOS is prompting', async ({
  page,
}) => {
  let waiting = true;
  await page.route('**/api/providers/health', (route) =>
    route.fulfill({ json: { issues: [], keychainWaiting: waiting } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const notice = providers.getByRole('status').filter({ hasText: 'keychain' });
  await expect(notice).toContainText('macOS is asking to let Spark use the keychain');
  await expect(notice).toContainText('Always Allow');
  await expect(providers.locator('.ptile[data-prov="claude"]')).toBeEnabled();

  const audit = await new AxeBuilder({ page }).include('.keychain-notice').analyze();
  expect(audit.violations).toEqual([]);

  waiting = false;
  await expect(notice).toHaveCount(0, { timeout: 10_000 });
});
