import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { REJECTED_KEY_MARKER } from './stub-config.ts';

const CLAUDE_KEY = `sk-ant-api03-${'a'.repeat(24)}4f2a`;
const REJECTED_CLAUDE_KEY = `sk-ant-api03-${REJECTED_KEY_MARKER}-${'b'.repeat(16)}`;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: false });
});

const dialog = (page: Page) => page.locator('.onb');
const continueButton = (page: Page) => dialog(page).getByRole('button', { name: 'Continue' });
const claudeCard = (page: Page) => dialog(page).locator('.pcard').filter({ hasText: 'Claude' });

async function enterName(page: Page, name: string) {
  await page.goto('/');
  await expect(
    dialog(page).getByRole('heading', { name: 'Welcome to Spark Outpost' }),
  ).toBeVisible();
  await expect(continueButton(page)).toBeDisabled();
  await expect(dialog(page)).toContainText('Enter your name to continue.');
  await dialog(page).getByLabel('What should we call you?').fill(name);
  await expect(dialog(page)).toContainText(`Nice to meet you, ${name.split(' ')[0]}`);
  await dialog(page).getByLabel('What should we call you?').press('Enter');
  await expect(dialog(page).getByRole('heading', { name: 'Pick a theme' })).toBeVisible();
  await continueButton(page).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Connect your AI providers' }),
  ).toBeVisible();
}

async function openTile(page: Page, name: string) {
  await dialog(page).locator('.pcard').filter({ hasText: name }).locator('.pc-head').click();
}

async function openApiKeyTab(page: Page) {
  await openTile(page, 'Claude');
  await claudeCard(page).getByRole('tab', { name: 'API key' }).click();
  await expect(
    claudeCard(page).getByRole('link', { name: 'Claude Console (opens in a new tab)' }),
  ).toHaveAttribute('href', 'https://platform.claude.com/settings/keys');
  return claudeCard(page).getByLabel('Claude API key');
}

test('first run goes through name, provider, defaults, and done, then opens the app', async ({
  page,
}) => {
  await enterName(page, 'Hazel Morgan');
  await expect(continueButton(page)).toBeDisabled();
  await expect(dialog(page)).toContainText('Connect at least one provider to continue.');

  const key = await openApiKeyTab(page);
  await key.fill(CLAUDE_KEY);
  await expect(claudeCard(page)).toContainText('Looks right. Verify to finish connecting.');
  await key.press('Enter');

  await expect(claudeCard(page)).toContainText('Connected');
  await expect(claudeCard(page)).toContainText('sk-ant-…4f2a');
  await expect(dialog(page).locator('.onb-foot .why')).toBeEmpty();

  const model = claudeCard(page).getByRole('button', { name: 'Claude model' });
  await model.click();
  await page.getByRole('menuitemradio', { name: /Claude Sonnet 5/ }).click();
  await expect(model).toHaveText('Claude Sonnet 5');
  const effort = claudeCard(page).getByRole('button', { name: 'Claude effort' });
  await expect(effort).toHaveText('Medium');
  await effort.click();
  await page.getByRole('menuitemradio', { name: /^High/ }).click();
  await expect(effort).toHaveText('High');
  const mode = claudeCard(page).getByRole('button', { name: 'Claude default mode' });
  await expect(claudeCard(page).getByRole('button', { name: /permissions/i })).toHaveCount(0);
  await expect(mode).toHaveText('Manual (default)');
  await mode.click();
  await expect(page.getByRole('menuitemradio')).toHaveText([
    /^Manual \(default\)Always ask before making changes/,
    /^Accept edits/,
    /^Plan/,
    /^Auto/,
    /^Bypass permissions/,
  ]);
  await page.getByRole('menuitemradio', { name: /^Accept edits/ }).click();
  await expect(mode).toHaveText('Accept edits');
  const autonomy = claudeCard(page).getByRole('button', { name: 'Claude harness autonomy' });
  await expect(autonomy).toHaveText('Automatic');
  await autonomy.click();
  await expect(page.getByRole('menuitemradio')).toHaveText([
    /^Review each step/,
    /^Automatic/,
    /^Full auto → PR/,
  ]);
  await page.getByRole('menuitemradio', { name: /^Review each step/ }).click();
  await expect(autonomy).toHaveText('Review each step');

  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Bring in your tools' })).toBeVisible();
  await expect(dialog(page).locator('.ccard')).toHaveCount(4);
  await expect(dialog(page).locator('.ccard').first()).toContainText('GitHub');
  await expect(dialog(page).locator('.ccard').nth(1)).toContainText('Coming soon');
  await expect(dialog(page).getByRole('button', { name: 'Connect' })).toHaveCount(0);

  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: "You're all set, Hazel" })).toBeVisible();
  await expect(dialog(page)).toContainText('Claude via API key');
  await expect(dialog(page)).toContainText(
    'Claude Sonnet 5, high effort, Accept edits · Review each step',
  );
  await expect(dialog(page)).toContainText('Tools coming soon');

  await dialog(page).getByRole('button', { name: 'Open Spark Outpost' }).click();
  await expect(page.locator('.onb')).toHaveCount(0);
  await expect(page.locator('#home-greet')).toBeVisible();

  await page.reload();
  await expect(page.locator('#home-greet')).toBeVisible();
  await expect(page.locator('.onb')).toHaveCount(0);
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

const card = (page: Page, name: string) => dialog(page).locator('.pcard').filter({ hasText: name });
const terminalIn = (scope: ReturnType<typeof card>) =>
  scope.getByRole('region', { name: 'Terminal' });
const terminalText = (scope: ReturnType<typeof card>) =>
  terminalIn(scope).locator('.xterm-accessibility');

test('a missing CLI opens a terminal with the install command and checks again after install', async ({
  page,
}) => {
  await enterName(page, 'Hazel');
  const claude = card(page, 'Claude');
  await openTile(page, 'Claude');
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
});

test('an installed but logged-out CLI goes straight to login and connects by itself', async ({
  page,
}) => {
  await enterName(page, 'Hazel');
  const codex = card(page, 'Codex');
  await openTile(page, 'Codex');
  await codex.getByRole('button', { name: 'Detect and verify' }).click();

  await expect(terminalIn(codex)).toContainText('Sign in to Codex');
  await expect(terminalIn(codex)).toContainText("You're not logged in to the codex CLI.");
  await expect(terminalText(codex)).toContainText('codex login');
  await expect(terminalText(codex)).not.toContainText('npm i -g');

  await page.keyboard.press('Enter');
  await expect(terminalIn(codex)).toContainText(
    "You're logged in. Checking again to finish connecting.",
  );

  await expect(codex).toContainText('Connected');
  await expect(codex.getByRole('region', { name: 'Connection' })).toContainText('CLIcodex 0.99.0');
  await expect(codex.getByRole('region', { name: 'Connection' })).toContainText(
    'LoginLogged in using ChatGPT',
  );
  await codex.getByRole('button', { name: 'Send test message' }).click();
  await expect(codex.getByRole('region', { name: 'Connection' })).toContainText(
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

  await claudeCard(page).getByRole('button', { name: 'More Claude actions' }).click();
  await claudeCard(page).getByRole('menuitem', { name: 'Disconnect' }).click();
  await expect(claudeCard(page).getByRole('tab', { name: 'API key' })).toBeVisible();
  await expect(claudeCard(page)).not.toContainText('Connected with');
  await expect(continueButton(page)).toBeDisabled();
  await expect(dialog(page)).toContainText('Connect at least one provider to continue.');

  await page.reload();
  await expect(
    dialog(page).getByRole('heading', { name: 'Connect your AI providers' }),
  ).toBeVisible();
});

test('provider tiles start collapsed and open one at a time', async ({ page }) => {
  await enterName(page, 'Hazel');
  const heads = dialog(page).locator('.pc-head');
  await expect(heads).toHaveCount(4);
  for (const head of await heads.all())
    await expect(head).toHaveAttribute('aria-expanded', 'false');

  await openTile(page, 'Claude');
  await expect(heads.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await openTile(page, 'Codex');
  await expect(heads.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(heads.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await openTile(page, 'Codex');
  await expect(heads.nth(1)).toHaveAttribute('aria-expanded', 'false');
});

test('Jev connects with an API key as optional decisions and does not unlock chats', async ({
  page,
}) => {
  await enterName(page, 'Hazel');
  const jev = dialog(page).locator('.pcard').filter({ hasText: 'Jev' });
  await expect(dialog(page).getByRole('heading', { name: 'Optional decisions' })).toBeVisible();
  await openTile(page, 'Jev');
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
  const details = jev.getByRole('region', { name: 'Connection' });
  await expect(details).toContainText('Key…c3d4');
  await expect(details).toContainText('Modeljev-latest');
  await expect(details).toContainText('Never keys or tool output');
  await expect(jev.getByRole('button', { name: 'Send test message' })).toHaveCount(0);
  await expect(continueButton(page)).toBeDisabled();

  await jev.getByRole('button', { name: 'More Jev actions' }).click();
  await jev.getByRole('menuitem', { name: 'Disconnect' }).click();
  await expect(jev.locator('.pill-ok')).toHaveCount(0);
});

test('a connected provider says what was checked and can send a test message', async ({ page }) => {
  await enterName(page, 'Hazel');
  const key = await openApiKeyTab(page);
  await key.fill(CLAUDE_KEY);
  await key.press('Enter');

  const details = claudeCard(page).getByRole('region', { name: 'Connection' });
  await expect(details).toContainText('Keysk-ant-…4f2a');
  await expect(details).toContainText('CheckedVerified with Anthropic just now');
  await expect(details).toContainText('Last testNot sent yet');
  await claudeCard(page).getByRole('button', { name: 'Send test message' }).click();
  await expect(details).toContainText(
    /Last testTest message answered in \d+\.\d s by claude-opus-5-5 · just now/,
  );

  await page.reload();
  await openTile(page, 'Claude');
  await expect(claudeCard(page)).toContainText('Test message answered in');
});

test('the theme step applies the chosen theme and remembers it', async ({ page }) => {
  await page.goto('/');
  await dialog(page).getByLabel('What should we call you?').fill('Hazel');
  await continueButton(page).click();
  const previewBackground = (skin: string) =>
    dialog(page)
      .locator(`.tprev[data-skin="${skin}"]`)
      .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await previewBackground('moss')).toBe('rgb(17, 20, 14)');
  expect(await previewBackground('fjord')).toBe('rgb(237, 241, 245)');
  expect(await previewBackground('lagoon')).toBe('rgb(232, 242, 241)');
  expect(await previewBackground('plum')).toBe('rgb(21, 15, 23)');
  expect(await previewBackground('sage')).toBe('rgb(236, 239, 228)');
  expect(await previewBackground('aurora')).toBe('rgb(17, 15, 38)');
  expect(await previewBackground('iris')).toBe('rgb(243, 240, 254)');
  await expect(dialog(page).getByRole('radio')).toHaveCount(12);

  const apricot = dialog(page).getByRole('radio', { name: 'Apricot' });
  await apricot.click();
  await expect(apricot).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('apricot');

  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('apricot');
});

test('with two providers connected, the default is set from inside a provider card', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: false, connected: ['claude', 'codex'] });
  await page.goto('/');
  await expect(
    dialog(page).getByRole('heading', { name: 'Connect your AI providers' }),
  ).toBeVisible();
  const codexCard = dialog(page).locator('.pcard').filter({ hasText: 'Codex' });
  await expect(claudeCard(page).locator('.tag-default')).toHaveText('Default');
  await expect(codexCard.locator('.tag-default')).toHaveCount(0);

  await openTile(page, 'Claude');
  await claudeCard(page).getByRole('button', { name: 'More Claude actions' }).click();
  await expect(claudeCard(page).getByRole('menuitem', { name: /Make default/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await openTile(page, 'Codex');
  await codexCard.getByRole('button', { name: 'More Codex actions' }).click();
  await codexCard.getByRole('menuitem', { name: /Make default/ }).click();
  await expect(codexCard.locator('.tag-default')).toHaveText('Default');
  await expect(claudeCard(page).locator('.tag-default')).toHaveCount(0);
  await codexCard.getByRole('button', { name: 'More Codex actions' }).click();
  await expect(codexCard.getByRole('menuitem', { name: /Make default/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(codexCard.locator('.tag-default')).toHaveText('Default');
});
