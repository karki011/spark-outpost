import { expect, test } from '@playwright/test';
import { resetTestDatabase, uninstallFakeClaude } from './database.ts';
import { REJECTED_KEY_MARKER } from './stub-config.ts';
import {
  CLAUDE_KEY,
  claudeCard,
  continueButton,
  dialog,
  enterName,
  holdToConfirm,
  openApiKeyTab,
  openTile,
  screen,
  section,
  tile,
} from './onboarding-flow.ts';

const REJECTED_CLAUDE_KEY = `sk-ant-api03-${REJECTED_KEY_MARKER}-${'b'.repeat(16)}`;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: false });
});

test('API key hints and a rejected key explain what to fix', async ({ page }) => {
  await enterName(page, 'Hazel');
  const key = await openApiKeyTab(page);
  const verify = claudeCard(page).getByRole('button', { name: 'Verify key' });

  await key.fill('sk-proj-abcdefghijklmnopqrstuvwxyz');
  await expect(claudeCard(page)).toContainText('Claude keys start with sk-ant-');
  await expect(verify).toBeDisabled();

  await key.fill('sk-ant-short');
  await expect(claudeCard(page)).toContainText('This key looks too short');

  await key.fill(REJECTED_CLAUDE_KEY);
  await verify.click();
  await expect(claudeCard(page)).toContainText(
    "Anthropic rejected this key (401 Unauthorized). Check that it's active and copied in full.",
  );
  await expect(continueButton(page)).toBeDisabled();
});

const terminalIn = (scope: ReturnType<typeof screen>) =>
  scope.getByRole('region', { name: 'Terminal' });
const terminalText = (scope: ReturnType<typeof screen>) =>
  terminalIn(scope).locator('.xterm-accessibility');

test('a missing CLI opens a terminal with the install command and checks again after install', async ({
  page,
}) => {
  uninstallFakeClaude();
  await enterName(page, 'Hazel');
  const claude = screen(page, 'claude');
  await openTile(page, 'claude');
  await claude.getByRole('button', { name: 'Detect and verify' }).click();

  await expect(terminalIn(claude)).toContainText('Install Claude');
  await expect(terminalIn(claude)).toContainText(
    "The claude CLI isn't installed or isn't on your PATH.",
  );
  await expect(claude.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(terminalText(claude)).toContainText('npm i -g @anthropic-ai/claude-code');

  await page.keyboard.press('Control+U');
  await page.keyboard.type('echo "added $((1 + 2)) packages"');
  await page.keyboard.press('Enter');
  await expect(terminalIn(claude)).toContainText(
    "Installed claude. Checking whether you're logged in.",
  );
  await expect(terminalIn(claude)).toContainText('Checking again');

  await expect(terminalText(claude)).toContainText('npm i -g @anthropic-ai/claude-code');
  await expect(terminalIn(claude)).not.toContainText('Checking again');

  await terminalIn(claude).getByRole('button', { name: 'Close' }).click();
  await expect(terminalIn(claude)).toContainText('Terminal closed.');
  await terminalIn(claude).getByRole('button', { name: 'Dismiss' }).click();
  await expect(terminalIn(claude)).toHaveCount(0);
  await expect(claude.getByRole('button', { name: 'Open terminal' })).toBeVisible();

  await claude.getByRole('button', { name: 'Back to AI providers' }).click();
  await expect(tile(page, 'claude')).toContainText('CLI not installed');
  await expect(tile(page, 'claude')).toContainText(
    'Install it with npm i -g @anthropic-ai/claude-code',
  );
});

test('API key mode needs the claude CLI and offers the same install step', async ({ page }) => {
  uninstallFakeClaude();
  await enterName(page, 'Hazel');
  const claude = claudeCard(page);
  const key = await openApiKeyTab(page);
  await expect(claude).toContainText('API key mode also needs the claude CLI installed.');
  await key.fill(CLAUDE_KEY);
  await key.press('Enter');

  await expect(terminalIn(claude)).toContainText('Install Claude');
  await expect(terminalIn(claude)).toContainText(
    'API key mode also needs the claude CLI installed.',
  );
  await expect(terminalText(claude)).toContainText('npm i -g @anthropic-ai/claude-code');
  await expect(continueButton(page)).toBeDisabled();
  await claude.getByRole('button', { name: 'Back to AI providers' }).click();
  await expect(tile(page, 'claude')).toContainText('CLI not installed');
  await expect(tile(page, 'claude')).toContainText('npm i -g @anthropic-ai/claude-code');
});

test('an installed but logged-out CLI goes straight to login and connects by itself', async ({
  page,
}) => {
  await enterName(page, 'Hazel');
  const codex = screen(page, 'codex');
  await openTile(page, 'codex');
  await codex.getByRole('button', { name: 'Detect and verify' }).click();

  await expect(terminalIn(codex)).toContainText('Sign in to Codex');
  await expect(terminalIn(codex)).toContainText("You're not logged in to the codex CLI.");
  await expect(terminalText(codex)).toContainText('codex login');
  await expect(terminalText(codex)).not.toContainText('npm i -g');

  await page.keyboard.press('Enter');
  await expect(terminalIn(codex)).toContainText(
    "You're logged in. Checking again to finish connecting.",
  );

  await expect(codex).toContainText('Connected · Local CLI');
  const connection = section(page, 'codex', 'How to connect');
  await expect(connection).toContainText('CLIcodex 0.99.0');
  await expect(connection).toContainText('LoginLogged in using ChatGPT');
  await codex.getByRole('button', { name: 'Send test message' }).click();
  await expect(section(page, 'codex', 'Test')).toContainText(
    /Test message answered in .* by gpt-5-codex/,
  );
  await expect(terminalIn(codex)).toHaveCount(0);
  await expect(dialog(page).locator('.onb-foot .why')).toBeEmpty();
});

test('the only provider can be disconnected, and setup resumes at the provider step', async ({
  page,
}) => {
  await enterName(page, 'Hazel');
  const key = await openApiKeyTab(page);
  await key.fill(CLAUDE_KEY);
  await key.press('Enter');
  await expect(claudeCard(page)).toContainText('Connected');
  await expect(continueButton(page)).toBeEnabled();

  await holdToConfirm(page, 'Hold to remove the Claude key');
  await page.locator('.toast.grace').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast.grace')).toHaveCount(0);
  await expect(claudeCard(page)).toContainText('Connected · API key');

  await holdToConfirm(page, 'Hold to remove the Claude key');
  await expect(claudeCard(page).getByRole('tab', { name: 'API key' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(claudeCard(page)).not.toContainText('Connected with');
  await expect(continueButton(page)).toBeDisabled();
  await expect(dialog(page)).toContainText('Connect at least one provider to continue.');

  await page.reload();
  await expect(
    dialog(page).getByRole('heading', { name: 'Connect your AI providers' }),
  ).toBeVisible();
});

test('provider tiles open a configure screen and close back to the same tile', async ({ page }) => {
  await enterName(page, 'Hazel');
  const tiles = dialog(page).locator('.ptile');
  await expect(tiles).toHaveCount(4);
  await expect(
    dialog(page).getByRole('button', { name: 'Codex Not set up', exact: true }),
  ).toHaveAccessibleDescription('Connect with the codex CLI or an API key');

  await tile(page, 'claude').focus();
  await page.keyboard.press('Enter');
  await expect(screen(page, 'claude').getByRole('heading', { name: 'Claude' })).toBeVisible();
  await expect(tiles).toHaveCount(0);
  await expect(
    screen(page, 'claude').getByRole('button', { name: 'Back to AI providers' }),
  ).toBeFocused();
  for (const name of ['How to connect', 'Test', 'Defaults for new chats'])
    await expect(section(page, 'claude', name)).toBeVisible();
  await expect(section(page, 'claude', 'Danger zone')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(tiles).toHaveCount(4);
  await expect(tile(page, 'claude')).toBeFocused();

  await openTile(page, 'codex');
  await screen(page, 'codex').getByRole('button', { name: 'Back to AI providers' }).click();
  await expect(tile(page, 'codex')).toBeFocused();
});

test('Jev connects with an API key as the advisor and does not unlock chats', async ({ page }) => {
  await enterName(page, 'Hazel');
  const jev = screen(page, 'jev');
  await expect(dialog(page).getByRole('heading', { name: 'Advisor' })).toBeVisible();
  await openTile(page, 'jev');
  await expect(jev.getByRole('tab')).toHaveCount(0);
  await expect(jev.getByRole('link', { name: /TypeSafe console/ })).toHaveAttribute(
    'href',
    'https://console.typesafe.ai/keys',
  );

  const key = jev.getByLabel('Jev API key');
  await key.fill(`${REJECTED_KEY_MARKER}-typesafe-fixture-key`);
  await jev.getByRole('button', { name: 'Verify key' }).click();
  await expect(jev).toContainText('TypeSafe rejected this key (401 Unauthorized).');

  await key.fill('typesafe-fixture-key-0000c3d4');
  await key.press('Enter');
  await expect(section(page, 'jev', 'How to connect')).toContainText('Key…c3d4');
  const settings = section(page, 'jev', 'Settings');
  await expect(settings).toContainText('Modeljev-latest');
  await expect(settings).toContainText('Never keys, tool output or your chat history');
  await expect(jev.getByRole('button', { name: 'Send test message' })).toHaveCount(0);
  await expect(continueButton(page)).toBeDisabled();

  await holdToConfirm(page, 'Hold to remove the Jev key');
  await expect(jev.locator('.pchip.ok')).toHaveCount(0, { timeout: 15_000 });
  await expect(jev.getByLabel('Jev API key')).toBeVisible();
});

test('a connected provider says what was checked and can send a test message', async ({ page }) => {
  await enterName(page, 'Hazel');
  const key = await openApiKeyTab(page);
  await key.fill(CLAUDE_KEY);
  await key.press('Enter');

  const connection = section(page, 'claude', 'How to connect');
  await expect(connection).toContainText('Keysk-ant-…4f2a');
  await expect(connection).toContainText('CheckedVerified with Anthropic just now');
  const details = section(page, 'claude', 'Test');
  await expect(details).toContainText('Last testNot sent yet');
  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route('**/api/providers/claude/test', async (route) => {
    await held;
    await route.continue();
  });
  await claudeCard(page).getByRole('button', { name: 'Send test message' }).click();
  const asking = claudeCard(page).getByRole('button', { name: /^Asking Claude…/ });
  await expect(asking).toHaveAttribute('aria-disabled', 'true');
  await expect(asking).toContainText(/Asking Claude…1 s/);
  await expect(details).toContainText('Last testWaiting for Claude to reply');
  await expect(claudeCard(page).locator('.plogo')).toHaveClass(/test-asking/);
  await expect(claudeCard(page).locator('.test-bubble i')).toHaveCount(3);
  answer();
  await expect(details).toContainText(
    /Last testTest message answered in \d+\.\d s by claude-opus-5-5 · just now/,
  );
  await expect(claudeCard(page).locator('.test-bubble.answered')).toBeVisible();
  await expect(claudeCard(page).locator('.plogo')).toHaveClass(/test-answered/);
  await expect(claudeCard(page).getByRole('button', { name: 'Send test message' })).toBeVisible();
  await expect(claudeCard(page).locator('.test-bubble')).toHaveCount(0);

  await page.reload();
  await expect(tile(page, 'claude')).toContainText('Last test passed');
  await openTile(page, 'claude');
  await expect(claudeCard(page)).toContainText('Test message answered in');
});

test('with two providers connected, the default is set from inside a provider screen', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: false, connected: ['claude', 'codex'] });
  await page.goto('/');
  await expect(
    dialog(page).getByRole('heading', { name: 'Connect your AI providers' }),
  ).toBeVisible();
  await expect(tile(page, 'claude').locator('.tag-default')).toHaveText('Default');
  await expect(tile(page, 'codex').locator('.tag-default')).toHaveCount(0);

  await openTile(page, 'claude');
  await expect(claudeCard(page).getByRole('button', { name: 'Make default' })).toHaveCount(0);
  await expect(claudeCard(page)).toContainText('New chats start with Claude.');
  await page.keyboard.press('Escape');
  await openTile(page, 'codex');
  const codex = screen(page, 'codex');
  await codex.getByRole('button', { name: 'Make default' }).click();
  await expect(codex).toContainText('New chats start with Codex.');
  await expect(codex.getByRole('button', { name: 'Make default' })).toHaveCount(0);
  await codex.getByRole('button', { name: 'Done' }).click();
  await expect(tile(page, 'codex').locator('.tag-default')).toHaveText('Default');
  await expect(tile(page, 'claude').locator('.tag-default')).toHaveCount(0);

  await page.reload();
  await expect(tile(page, 'codex').locator('.tag-default')).toHaveText('Default');
});
