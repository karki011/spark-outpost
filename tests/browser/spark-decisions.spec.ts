import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function openSettingsAt(page: Page, section: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: section })
    .click();
  return page.getByRole('dialog', { name: section });
}

function profileSaved(page: Page) {
  return page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
}

async function savedProfile(page: Page) {
  return (await (await page.request.get('/api/setup')).json()).profile;
}

test('new chats start at Full auto → PR, and one click in Settings puts the default back to Automatic', async ({
  page,
}) => {
  const before = await (await page.request.get('/api/chat-settings/defaults')).json();
  expect(before.level).toBe('full-auto');
  const spark = await openSettingsAt(page, 'Chats & autonomy');
  const level = spark.getByRole('radiogroup', { name: 'How much Spark does alone' });
  await expect(level.getByRole('radio', { name: 'Full auto → PR' })).toBeChecked();
  await expect(level).toHaveAccessibleDescription(
    'The default for new chats, whichever agent they use.',
  );
  const saved = profileSaved(page);
  await level.getByRole('radio', { name: 'Automatic' }).click();
  await saved;
  await expect(level.getByRole('radio', { name: 'Automatic' })).toBeChecked();
  const defaults = await (await page.request.get('/api/chat-settings/defaults')).json();
  expect(defaults.level).toBe('hands-off');
});

test('Spark settings offer no spend cap or budget', async ({ page }) => {
  const spark = await openSettingsAt(page, 'Chats & autonomy');
  await expect(spark.getByRole('radiogroup', { name: 'How much Spark does alone' })).toBeVisible();
  await expect(spark.getByText(/spend cap|budget/i)).toHaveCount(0);
});

test('the morning brief saves its time and can be turned off', async ({ page }) => {
  const spark = await openSettingsAt(page, 'Notifications');
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

async function markUpdatedInstall() {
  const db = openTestDb();
  try {
    await db.query('UPDATE profiles SET default_level_notice = true');
  } finally {
    await db.end();
  }
}

const NEW_DEFAULT_NOTICE =
  'New chats now use Full auto → PR: Spark opens a pull request when the work is done.';

test('a new install never sees the notice about the new default', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText(NEW_DEFAULT_NOTICE)).toHaveCount(0);
});

test('an updated install is told once about the new default and can dismiss it', async ({
  page,
}) => {
  await markUpdatedInstall();
  await page.goto('/');
  const notice = page.getByRole('complementary', { name: 'Default for new chats changed' });
  await expect(notice).toContainText(NEW_DEFAULT_NOTICE);
  await expect(page.locator('[role="alert"], [role="alertdialog"]')).toHaveCount(0);

  const saved = profileSaved(page);
  await notice.getByRole('button', { name: 'Dismiss' }).focus();
  await page.keyboard.press('Enter');
  await saved;
  await expect(notice).toHaveCount(0);
  expect((await savedProfile(page)).defaultLevel).toBe('full-auto');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText(NEW_DEFAULT_NOTICE)).toHaveCount(0);
});

test('the notice links to the setting, where Automatic is one click away', async ({ page }) => {
  await markUpdatedInstall();
  await page.goto('/');
  const notice = page.getByRole('complementary', { name: 'Default for new chats changed' });
  await notice.getByRole('button', { name: 'Change the default in Settings' }).click();

  const spark = page.getByRole('dialog', { name: 'Chats & autonomy' });
  const level = spark.getByRole('radiogroup', { name: 'How much Spark does alone' });
  await expect(level.getByRole('radio', { name: 'Full auto → PR' })).toBeChecked();
  await expect(level.getByRole('radio', { name: 'Full auto → PR' })).toBeFocused();
  await expect(notice).toHaveCount(0);
  const saved = profileSaved(page);
  await level.getByRole('radio', { name: 'Automatic' }).click();
  await saved;
  expect(await savedProfile(page)).toMatchObject({
    defaultLevel: 'hands-off',
    defaultLevelNotice: false,
  });
});
