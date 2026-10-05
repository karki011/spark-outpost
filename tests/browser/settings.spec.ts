import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expandSection } from './provider-screen.ts';
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
  const claude = providers.locator('.pconf[data-prov="claude"]');
  await providers.locator('.ptile[data-prov="claude"]').click();
  await expect(page).toHaveURL(/#\/settings\/providers\/claude$/);
  await expandSection(claude, 'How to connect');
  await claude.getByRole('button', { name: 'Sign in again' }).click();
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
  await expect(page).not.toHaveURL(/#\/settings/);
  const cards = page.getByRole('dialog', { name: 'Appearance' }).locator('.tcard');
  await expect(cards).toHaveCount(12);
  const lefts = await cards.evaluateAll((all) =>
    all.map((card) => Math.round(card.getBoundingClientRect().left)),
  );
  expect(new Set(lefts).size).toBe(4);

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
  await expect(spark.getByRole('tab', { name: 'Spark', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(spark.getByRole('tab', { name: 'Profile' })).toHaveCount(0);

  const sparkSwitch = spark.getByRole('switch', { name: 'Spark', exact: true });
  await expect(sparkSwitch).toHaveAttribute('aria-checked', 'true');
  const switches = spark.getByRole('switch');
  await expect(switches).toHaveCount(8);
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
  await expect(page.getByRole('tooltip')).toContainText('rules pick the model');
  await expect(page.getByRole('tooltip').getByRole('listitem')).toHaveText([/^On/, /^Off/]);
  await page.keyboard.press('Escape');
  await expect(spark).toBeVisible();

  await expect
    .poll(async () => (await (await page.request.get('/api/setup')).json()).profile)
    .toMatchObject({ sparkEnabled: false, personality: 'facts' });

  await expect(spark.getByRole('radiogroup', { name: 'Status companion' })).toBeVisible();
  const wait = spark.getByRole('radiogroup', { name: 'Wait before going with best guesses' });
  await expect(wait.getByRole('radio')).toHaveText([
    '30s',
    '60s',
    '2 min',
    '5 min',
    'Never',
    'Custom',
  ]);
  await expect(wait.getByRole('radio', { name: '60s' })).toBeChecked();
  await expect(wait).toHaveAccessibleDescription(
    'After 60s, Spark goes with its best guess or the safe option.',
  );
  const savedWait = async () =>
    (await (await page.request.get('/api/setup')).json()).profile.autoContinueSeconds;
  await wait.getByRole('radio', { name: 'Never' }).click();
  await expect(wait).toHaveAccessibleDescription('Spark waits for your answer.');
  await expect.poll(savedWait).toBeNull();
  await wait.getByRole('radio', { name: 'Custom' }).click();
  const custom = spark.getByRole('textbox', { name: 'Custom wait in seconds' });
  await custom.fill('3');
  await custom.press('Enter');
  await expect(custom).toHaveAttribute('aria-invalid', 'true');
  await expect(wait).toHaveAccessibleDescription('Enter a whole number of seconds from 5 to 600.');
  expect(await savedWait()).toBeNull();
  await custom.fill('45');
  await custom.press('Enter');
  await expect(wait).toHaveAccessibleDescription(
    'After 45s, Spark goes with its best guess or the safe option.',
  );
  await expect.poll(savedWait).toBe(45);
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(wait.getByRole('radio', { name: 'Custom' })).toBeChecked();
  await expect(custom).toHaveValue('45');
  await wait.getByRole('radio', { name: '2 min' }).click();
  await expect.poll(savedWait).toBe(120);
  await expect(custom).toHaveCount(0);
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
  const claude = providers.locator('.pconf[data-prov="claude"]');
  await providers.locator('.ptile[data-prov="claude"]').click();
  await expandSection(claude, 'Defaults for new chats');
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
    await expect(claude).toBeVisible();
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
    'That PR always opens as a draft marked “Checks failing”, even when PRs open ready for review. Full auto never merges.',
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

test('the Jev screen keeps only its own switch and explains it in an info tip', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  await expect(providers.getByRole('region', { name: 'Advisor' })).toContainText('Not set up');
  await providers.locator('.ptile[data-prov="jev"]').click();
  const jev = providers.locator('.pconf[data-prov="jev"]');
  await expandSection(jev, 'Settings');
  const advisor = jev.getByRole('region', { name: 'Settings' });
  await expect(providers).not.toContainText('Full auto');
  await expect(advisor.getByRole('switch', { name: 'Check changes with Jev' })).toBeDisabled();
  await expect(advisor).toContainText('Connect Jev to use this.');
  await expect(
    advisor.getByRole('radiogroup', { name: 'Wait before going with best guesses' }),
  ).toHaveCount(0);

  const info = advisor.getByRole('button', { name: 'More about Check changes with Jev' });
  await expect(async () => {
    await info.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tooltip')).toContainText('never blocked or allowed', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(advisor).toBeVisible();
});

test('a failed test message makes the provider blob wobble and shows the error', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const claude = providers.locator('.pconf[data-prov="claude"]');
  await providers.locator('.ptile[data-prov="claude"]').click();
  await expandSection(claude, 'Test');
  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route('**/api/providers/claude/test', async (route) => {
    await held;
    await route.continue();
  });
  await claude.getByRole('button', { name: 'Send test message' }).click();
  await expect(claude.getByRole('button', { name: /^Asking Claude…/ })).toBeVisible();
  await expect(claude.locator('.test-bubble')).toBeVisible();
  answer();
  await expect(claude.getByRole('region', { name: 'Test' })).toContainText(
    'The test message failed',
  );
  await expect(claude.locator('.plogo')).toHaveClass(/test-failed/);
  await expect(claude.locator('.test-bubble')).toHaveCount(0);
  await expect(claude.getByRole('button', { name: 'Send test message' })).toBeVisible();
});

test('context compaction thresholds validate inline and save from Spark settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const spark = page.getByRole('dialog', { name: 'Spark' });
  const warn = spark.getByRole('textbox', { name: 'Warn when context is, in percent' });
  const compact = spark.getByRole('textbox', { name: 'Compact automatically at, in percent' });
  const saved = () =>
    page.waitForResponse((response) => response.url().endsWith('/api/profile') && response.ok());
  const profile = async () => (await (await page.request.get('/api/setup')).json()).profile;

  await expect(warn).toHaveValue('60');
  await expect(compact).toHaveValue('80');
  await expect(warn).toHaveAccessibleDescription('The context ring turns amber at 60% full.');

  await warn.fill('78');
  await expect(warn).toHaveAttribute('aria-invalid', 'true');
  await expect(warn).toHaveAccessibleDescription(
    'Warn at least 5 points below the compaction point.',
  );
  await warn.fill('20');
  await expect(warn).toHaveAccessibleDescription('Warn at a value from 30% to 90%.');
  let save = saved();
  await warn.fill('65');
  await warn.press('Enter');
  await save;
  await expect(warn).not.toHaveAttribute('aria-invalid');
  await expect(warn).toHaveAccessibleDescription('The context ring turns amber at 65% full.');

  await compact.fill('96');
  await expect(compact).toHaveAccessibleDescription('Compact at a value from 40% to 95%.');
  save = saved();
  await compact.fill('90');
  await compact.blur();
  await save;
  await expect(compact).toHaveAccessibleDescription(
    'Spark compacts at 90% and asks again at 95% after Keep going.',
  );

  const toggle = spark.getByRole('switch', { name: 'Compact automatically at' });
  save = saved();
  await toggle.click();
  await save;
  await expect(toggle).not.toBeChecked();
  await expect(compact).toBeHidden();
  await expect(toggle).toHaveAccessibleDescription(
    'Spark only warns and offers the card at 90%; it never compacts by itself.',
  );
  expect(await profile()).toMatchObject({
    compactWarnPercent: 65,
    compactAtPercent: 90,
    autoCompact: false,
  });
});

test('a provider link opens its screen, Escape steps back to the tiles, then closes', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'], jev: true });
  await page.goto('/#/settings/providers/codex');
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const codex = providers.getByRole('region', { name: 'Codex' });
  await expect(codex.getByRole('tab', { name: 'Local CLI' })).toBeVisible();
  await expect(codex.getByRole('button', { name: 'Back to AI providers' })).toBeFocused();
  const screen = await new AxeBuilder({ page })
    .include('.pconf')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(screen.violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(codex).toHaveCount(0);
  await expect(providers.locator('.ptile[data-prov="codex"]')).toBeFocused();
  await expect(page).toHaveURL(/#\/settings\/providers$/);
  await expect(
    providers.getByRole('button', { name: 'Claude Connected · Local CLI', exact: true }),
  ).toBeVisible();
  const tiles = await new AxeBuilder({ page })
    .include('.ptiles-view')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(tiles.violations).toEqual([]);

  await providers.locator('.ptile[data-prov="claude"]').click();
  const claude = providers.getByRole('region', { name: 'Claude' });
  for (const name of ['How to connect', 'Test', 'Defaults for new chats', 'Danger zone']) {
    const toggle = claude.getByRole('button', { name: new RegExp(`^${name}`) });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(claude.getByRole('button', { name: /^Test/ })).toContainText('Not sent yet');
  await expandSection(claude, 'Danger zone');
  await expandSection(claude, 'Defaults for new chats');
  const connected = await new AxeBuilder({ page })
    .include('.pconf')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(connected.violations).toEqual([]);
  await claude.getByRole('button', { name: 'Done' }).click();
  await expect(providers.locator('.ptile[data-prov="claude"]')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(providers).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/settings/);
});

test('disconnecting a CLI provider waits 10 seconds for Undo @packaged', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await page.goto('/#/settings/providers/codex');
  const codex = page.getByRole('dialog', { name: 'AI providers' }).getByRole('region', {
    name: 'Codex',
  });
  await expandSection(codex, 'Danger zone');
  const hold = codex.getByRole('button', { name: 'Hold to disconnect Codex' });
  await expect(hold).toHaveAccessibleDescription(
    'Spark stops using Codex. Your CLI login stays. You get 10 seconds to undo.',
  );
  await hold.focus();
  await page.keyboard.down(' ');
  await page.waitForTimeout(300);
  await page.keyboard.up(' ');
  await expect(codex).toContainText('Released early. Nothing happened.');

  await page.keyboard.down(' ');
  const grace = page.locator('.toast.grace');
  await expect(grace).toContainText('Disconnecting Codex…', { timeout: 5_000 });
  await page.keyboard.up(' ');
  await page.keyboard.press('Escape');
  await expect(grace).toHaveCount(0);
  await expect(codex).toContainText('Connected · Local CLI');

  await hold.focus();
  await page.keyboard.down(' ');
  await expect(grace).toBeVisible({ timeout: 5_000 });
  await page.keyboard.up(' ');
  await expect(codex.getByRole('tab', { name: 'API key' })).toBeVisible({ timeout: 15_000 });
  await expect(codex).toContainText('Not set up');
});
