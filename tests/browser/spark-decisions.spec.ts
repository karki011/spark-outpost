import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function openSpark(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog', { name: 'Spark' });
}

function profileSaved(page: Page) {
  return page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
}

async function savedProfile(page: Page) {
  return (await (await page.request.get('/api/setup')).json()).profile;
}

test('the default autonomy is one setting that new chats start with', async ({ page }) => {
  const spark = await openSpark(page);
  const level = spark.getByRole('radiogroup', { name: 'How much Spark does alone' });
  await expect(level.getByRole('radio', { name: 'Automatic' })).toBeChecked();
  await expect(level).toHaveAccessibleDescription(
    'The default for new chats, whichever agent they use.',
  );
  const saved = profileSaved(page);
  await level.getByRole('radio', { name: 'Full auto → PR' }).click();
  await saved;
  const defaults = await (await page.request.get('/api/chat-settings/defaults')).json();
  expect(defaults.level).toBe('full-auto');
});

test('the spend cap turns on with an amount you can change', async ({ page }) => {
  const spark = await openSpark(page);
  const cap = spark.getByRole('switch', { name: 'Spend cap per task' });
  const amount = spark.getByRole('textbox', { name: 'Spend cap in US dollars' });
  await expect(cap).toHaveAttribute('aria-checked', 'false');
  await expect(cap).toHaveAccessibleDescription('No spend limit per task.');
  await expect(amount).toHaveCount(0);

  await cap.click();
  await expect(amount).toHaveValue('5.00');
  await expect(cap).toHaveAccessibleDescription('Spark asks before a task spends more than $5.00.');
  await amount.fill('0');
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(amount).toHaveAccessibleDescription('Enter an amount from $0.01 to $10,000.');
  await amount.fill('2.5');
  const saved = profileSaved(page);
  await amount.press('Enter');
  await saved;
  await expect(amount).toHaveValue('2.50');
  await expect.poll(async () => (await savedProfile(page)).spendCapUsd).toBe(2.5);

  await cap.click();
  await expect(amount).toHaveCount(0);
  await expect.poll(async () => (await savedProfile(page)).spendCapUsd).toBeNull();
  await cap.click();
  await expect(amount).toHaveValue('2.50');
});

test('the morning brief saves its time and can be turned off', async ({ page }) => {
  const spark = await openSpark(page);
  const brief = spark.getByRole('switch', { name: 'Morning brief' });
  const time = spark.getByLabel('Morning brief time');
  await expect(brief).toHaveAttribute('aria-checked', 'true');
  await expect(time).toHaveValue('07:00');
  const saved = profileSaved(page);
  await time.fill('08:30');
  await saved;
  await expect(brief).toHaveAccessibleDescription('Spark writes it after 8:30 AM each morning.');
  await brief.click();
  await expect(time).toHaveCount(0);
  await expect(brief).toHaveAccessibleDescription('No brief each morning.');
  await expect
    .poll(() => savedProfile(page))
    .toMatchObject({ morningBrief: false, morningBriefTime: '08:30' });
});
