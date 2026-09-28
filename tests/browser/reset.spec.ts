import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Keep this chat' }]);
});

async function openReset(page: Page) {
  await openChats(page);
  await expect(page.getByRole('button', { name: 'Keep this chat', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('spark-outpost.models.provider', 'claude'));
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Profile' }).getByRole('tab', { name: 'Reset' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset' });
  await expect(dialog.getByText('What stays')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Hold to reset' })).toBeVisible();
  return dialog.locator('.hold-btn');
}

function countResetRequests(page: Page) {
  const seen = { count: 0 };
  page.on('request', (request) => {
    if (request.url().endsWith('/api/reset')) seen.count += 1;
  });
  return seen;
}

const graceBar = (page: Page) => page.locator('.toast.grace');

test('letting go early or pressing Undo keeps every chat', async ({ page }) => {
  test.setTimeout(90_000);
  const requests = countResetRequests(page);
  const hold = await openReset(page);

  await hold.hover();
  await page.mouse.down();
  await expect(page.getByText('Keep holding. Let go now to cancel.')).toBeVisible();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.getByText('Released early. Nothing happened.')).toBeVisible();
  await expect(graceBar(page)).toHaveCount(0);

  await page.mouse.down();
  await expect(graceBar(page)).toContainText('Resetting Spark…', { timeout: 3000 });
  await page.mouse.up();
  await expect(graceBar(page)).toContainText(/\d+s/);
  await expect(hold).toBeDisabled();
  await graceBar(page).getByRole('button', { name: 'Undo' }).click();
  await expect(graceBar(page)).toHaveCount(0);
  await expect(hold).toBeEnabled();

  await page.waitForTimeout(11_000);
  expect(requests.count).toBe(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Keep this chat', exact: true })).toBeVisible();
});

test('a full keyboard hold resets Spark to onboarding after the grace period', async ({ page }) => {
  test.setTimeout(90_000);
  const hold = await openReset(page);

  await hold.focus();
  await page.keyboard.down('Space');
  await expect(graceBar(page)).toBeVisible({ timeout: 3000 });
  await page.keyboard.up('Space');
  await expect(graceBar(page).getByRole('button', { name: 'Undo' })).toBeFocused();

  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Reset' })).toHaveCount(0);
  await expect(graceBar(page)).toBeVisible();

  const reset = await page.waitForResponse(
    (response) => response.url().endsWith('/api/reset') && response.request().method() === 'POST',
    { timeout: 15_000 },
  );
  expect(reset.status()).toBe(200);
  expect(reset.request().postDataJSON()).toEqual({ keepApiKeys: false });
  await expect(
    page.locator('.onb').getByRole('heading', { name: 'Welcome to Spark Outpost' }),
  ).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => localStorage.getItem('spark-outpost.models.provider'))).toBe(
    null,
  );
  await expect(page.locator('.onb').getByLabel('What should we call you?')).toHaveValue('');
});

for (const theme of ['light', 'graphite', 'contrast']) {
  test(`the grace bar has no serious contrast or ARIA issues in the ${theme} theme`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const hold = await openReset(page);
    await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);

    await hold.focus();
    await page.keyboard.down('Space');
    await expect(graceBar(page)).toBeVisible({ timeout: 3000 });
    await page.keyboard.up('Space');
    const results = await new AxeBuilder({ page })
      .include('.toast.grace')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) =>
        (violation.id === 'color-contrast' || violation.id.startsWith('aria-')) &&
        ['serious', 'critical'].includes(violation.impact ?? ''),
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
    await graceBar(page).getByRole('button', { name: 'Undo' }).click();
    await expect(graceBar(page)).toHaveCount(0);
  });
}
