import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('settings opens from the sidebar and lets a CLI provider sign in again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Spark' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('What should Spark call you?', { exact: true })).toHaveValue(
    'Test User',
  );

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
  await expect(page.getByRole('dialog', { name: 'Appearance' }).locator('.tcard')).toHaveCount(12);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toHaveCount(0);
});

test('the name saves from Spark settings and Spark greets you by first name', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const spark = page.getByRole('dialog', { name: 'Spark' });
  await spark.getByLabel('What should Spark call you?', { exact: true }).fill('Hazel Moss');
  await expect(spark.locator('.spark-preview')).toContainText('Hi Hazel 👋');
  await expect(page.getByText('Changes save automatically.')).toBeVisible();
  const profile = page.getByRole('navigation', { name: 'Main' }).getByRole('button', {
    name: 'Your profile, Hazel Moss',
  });
  await expect(profile).toBeVisible();
  await page.reload();
  await expect(profile).toBeVisible();
});

test('Spark toggles and personality save, and the moved settings live in Spark only', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const spark = page.getByRole('dialog', { name: 'Spark' });
  await expect(spark.getByRole('tab', { name: 'Spark' })).toHaveAttribute('aria-selected', 'true');
  await expect(spark.getByRole('tab', { name: 'Profile' })).toHaveCount(0);

  const sparkSwitch = spark.getByRole('switch', { name: 'Spark', exact: true });
  await expect(sparkSwitch).toHaveAttribute('aria-checked', 'true');
  const switches = spark.getByRole('switch');
  await expect(switches).toHaveCount(3);
  for (const removed of ['Call me by name', 'Work like a team', 'Critic']) {
    await expect(spark.getByText(removed, { exact: true })).toHaveCount(0);
  }
  await expect(sparkSwitch).toHaveAccessibleDescription(
    'Spark reads, routes and reviews your work.',
  );
  await sparkSwitch.focus();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await page.keyboard.press('Enter');
  await saved;
  await expect(sparkSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(sparkSwitch).toHaveAccessibleDescription('Chats go straight to the agent you pick.');
  await expect(spark.locator('.spark-preview .scout')).toHaveClass(/sleep/);

  const personality = spark.getByRole('radiogroup', { name: 'Personality' });
  await personality.getByRole('radio', { name: 'Just the facts' }).click();
  await expect(personality).toHaveAccessibleDescription('Short answers, no small talk.');

  const info = spark.getByRole('button', { name: 'More about Spark', exact: true });
  await info.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tooltip')).toContainText('the routing rules pick the model');
  await page.keyboard.press('Escape');
  await expect(spark).toBeVisible();

  await expect
    .poll(async () => (await (await page.request.get('/api/setup')).json()).profile)
    .toMatchObject({ sparkEnabled: false, personality: 'facts' });

  await expect(spark.getByRole('radiogroup', { name: 'Status companion' })).toBeVisible();
  const wait = spark.getByRole('radiogroup', { name: 'If you don’t answer a question' });
  await expect(wait.getByRole('radio', { name: '10s' })).toBeChecked();
  await expect(wait).toHaveAccessibleDescription('Spark picks the safe option.');
  const level = spark.getByRole('radiogroup', { name: 'How much Spark does alone' });
  await expect(level.getByRole('radio', { name: 'Automatic' })).toBeChecked();

  await spark.getByRole('tab', { name: 'Appearance' }).click();
  const appearance = page.getByRole('dialog', { name: 'Appearance' });
  await expect(appearance.locator('.tcard').first()).toBeVisible();
  await expect(appearance.getByRole('radiogroup', { name: 'Status companion' })).toHaveCount(0);
  await appearance.getByRole('tab', { name: /Connectors/ }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Connectors' })
      .getByRole('radiogroup', { name: 'When checks still fail in Full auto' }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Close settings' }).click();
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.getByRole('button', { name: 'Spark off' }).click();
  await expect(page.getByRole('dialog', { name: 'Spark' })).toBeVisible();
});

test('settings shows usage per provider', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Count my tokens');
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Spark' }).getByRole('tab', { name: 'Usage' }).click();
  const dialog = page.getByRole('dialog', { name: 'Usage' });
  const claude = dialog.getByRole('listitem', { name: 'Claude' });
  await expect(claude).toContainText('$0.004');
  await expect(claude).toContainText('1 reply · 1.2K tokens (900 in, 300 out)');
  await dialog.getByRole('radio', { name: 'All time' }).click();
  await expect(claude).toContainText('$0.004');
  await expect(dialog).toContainText('Claude reports its cost');
});

test('provider setting dropdowns return focus to their trigger after a keyboard choice', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const claude = providers.locator('.pcard').filter({ hasText: 'Claude' });
  await claude.locator('.pc-head').click();
  const rows = ['Claude default mode', 'Claude effort'];
  if ((await claude.getByRole('button', { name: 'Claude model' }).count()) > 0) {
    rows.unshift('Claude model');
  }

  for (const row of rows) {
    const trigger = claude.getByRole('button', { name: row });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: row });
    await expect(menu.getByRole('menuitemradio', { checked: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const saved = page.waitForResponse(
      (response) => response.url().endsWith('/providers/claude/defaults') && response.ok(),
    );
    await page.keyboard.press('Enter');
    await saved;
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitemradio', { checked: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(providers).toBeVisible();
  }
});

test('Spark sets what Full auto does when checks still fail, opening the draft PR by default', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const choice = page.getByRole('dialog', { name: 'Spark' }).getByRole('radiogroup', {
    name: 'When checks still fail in Full auto',
  });
  await expect(choice.getByRole('radio', { name: 'Open a draft PR' })).toBeChecked();
  await expect(choice).toHaveAccessibleDescription(
    'The draft PR is marked “Checks failing”. Full auto never merges.',
  );
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await choice.getByRole('radio', { name: 'Stop and ask' }).click();
  await saved;
  await expect(choice.getByRole('radio', { name: 'Stop and ask' })).toBeChecked();
  const profile = await page.request.get('/api/setup');
  expect((await profile.json()).profile.shipFailingChecks).toBe(false);
});

test('the Jev card keeps only its own switch and explains it in an info tip', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const advisor = providers.getByRole('region', { name: 'Advisor' });
  await expect(providers).not.toContainText('Full auto');
  await expect(advisor.getByRole('switch', { name: 'Check changes with Jev' })).toBeDisabled();
  await expect(advisor).toContainText('Connect Jev to use this.');
  await expect(
    advisor.getByRole('radiogroup', { name: 'If you don’t answer a question' }),
  ).toHaveCount(0);

  const info = advisor.getByRole('button', { name: 'More about Check changes with Jev' });
  await info.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tooltip')).toContainText('never blocked or allowed');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(providers).toBeVisible();
});
