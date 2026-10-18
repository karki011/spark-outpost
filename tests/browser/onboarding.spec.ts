import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  backPastMacAccess,
  CLAUDE_KEY,
  claudeCard,
  continueButton,
  continueFromTools,
  dialog,
  enterName,
  fakeFullDiskAccess,
  nameField,
  openApiKeyTab,
  tile,
} from './onboarding-flow.ts';

const SHOTS = path.resolve('test-results/auto-mode-prompts');
const CALENDAR_HOST = process.env.SPARK_FAKE_CALENDAR === '1';

async function shot(page: Page, name: string, colorScheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}-${colorScheme}.png`) });
}

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: false });
  await fakeFullDiskAccess(page, 'not_granted');
});

async function columnCount(page: Page) {
  const lefts = await dialog(page)
    .locator('.tcard')
    .evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().left)));
  return new Set(lefts).size;
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

  await expect(claudeCard(page)).toContainText('Connected · API key');
  await expect(claudeCard(page)).toContainText('sk-ant-…4f2a');
  await expect(dialog(page).locator('.onb-foot .why')).toBeEmpty();

  const model = claudeCard(page).getByRole('button', { name: 'Claude model' });
  await expect(model).toHaveText('Claude Opus 5.5');
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
  await expect(mode).toHaveText('Auto (default)');
  await mode.click();
  await expect(page.getByRole('menuitemradio')).toHaveText([
    /^ManualAlways ask before making changes/,
    /^Accept edits/,
    /^Plan/,
    /^Auto \(default\)/,
    /^Bypass permissions/,
  ]);
  await expect(page.getByRole('menuitemradio', { name: /^Auto/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: /^Accept edits/ }).click();
  await expect(mode).toHaveText('Accept edits');
  await expect(claudeCard(page).getByRole('button', { name: /harness autonomy/ })).toHaveCount(0);

  await claudeCard(page).getByRole('button', { name: 'Done' }).click();
  await expect(claudeCard(page)).toHaveCount(0);
  await expect(tile(page, 'claude')).toBeFocused();
  await expect(tile(page, 'claude')).toContainText('Connected · API key');
  await expect(tile(page, 'claude')).toContainText('Model Claude Sonnet 5');

  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Bring in your tools' })).toBeVisible();
  const git = dialog(page).getByRole('region', { name: 'Git' });
  await expect(git).toContainText('Spark is looking for Git…');
  await expect(git).toContainText(/Git \d+\.\d+/);
  await expect(git).toContainText('Found');
  const tools = dialog(page).locator('.cx-card');
  const names = ['GitHub', 'Jira', 'Linear', 'Slack', ...(CALENDAR_HOST ? ['Calendar'] : [])];
  await expect(tools).toHaveCount(names.length);
  for (const [index, name] of names.entries()) await expect(tools.nth(index)).toContainText(name);
  await expect(dialog(page).locator('.cx-card button.pc-head')).toHaveCount(names.length);

  await continueFromTools(page, "You're all set, Hazel");
  await expect(dialog(page).getByRole('heading', { name: "You're all set, Hazel" })).toBeVisible();
  await expect(dialog(page)).toContainText('Claude via API key');
  await expect(dialog(page)).toContainText(
    'Claude Sonnet 5, high effort, Accept edits · Full auto → PR',
  );
  await expect(dialog(page)).toContainText('Connect tools anytime in Settings');
  await expect(dialog(page)).not.toContainText('Tools coming soon');
  await expect(dialog(page).locator('.done-list')).toContainText(/Git \d+\.\d+/);

  await dialog(page).getByRole('button', { name: 'Open Spark Outpost' }).click();
  await expect(page.locator('.onb')).toHaveCount(0);
  await expect(page.locator('#home-greet')).toBeVisible();

  await page.reload();
  await expect(page.locator('#home-greet')).toBeVisible();
  await expect(page.locator('.onb')).toHaveCount(0);
});

test('Meet Spark sets the personality, and the blob reacts', async ({ page }) => {
  await page.goto('/');
  await expect(
    dialog(page).getByRole('button', { name: /Step 1 of \d+: Meet Spark/ }),
  ).toBeVisible();
  await nameField(page).fill('Sam Rivera');
  const preview = dialog(page).locator('.spark-preview');
  await expect(preview).toContainText('Hi Sam 👋');

  const personality = dialog(page).getByRole('radiogroup', { name: 'Personality' });
  await expect(personality.getByRole('radio', { name: 'Friendly' })).toBeChecked();
  await personality.getByRole('radio', { name: 'Playful' }).click();
  await expect(preview).toContainText('Hey Sam! 👋 Ready when you are.');
  await expect(preview.locator('.scout')).toHaveClass(/happy/);
  await expect(personality).toHaveAccessibleDescription(
    'Warm, a little humour, celebrates your wins.',
  );

  await expect(dialog(page).getByRole('switch')).toHaveCount(0);
  await expect
    .poll(async () => (await (await page.request.get('/api/setup')).json()).profile.personality)
    .toBe('playful');

  const profile = (await (await page.request.get('/api/setup')).json()).profile;
  expect(profile).toMatchObject({
    displayName: 'Sam Rivera',
    personality: 'playful',
  });
  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Pick a theme' })).toBeVisible();
});

test('the theme step applies the chosen theme and remembers it', async ({ page }) => {
  await page.goto('/');
  await nameField(page).fill('Hazel');
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
  expect(await columnCount(page)).toBe(4);
  const preview = await dialog(page).locator('.tprev').first().boundingBox();
  expect(preview?.height).toBeLessThanOrEqual(130);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => columnCount(page)).toBe(2);
  await page.setViewportSize({ width: 1280, height: 720 });

  const apricot = dialog(page).getByRole('radio', { name: 'Apricot' });
  await apricot.click();
  await expect(apricot).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('apricot');

  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('apricot');
});

test('without git, the tools step explains why and setup can still finish', async ({ page }) => {
  await resetTestDatabase({ onboarded: false, connected: ['claude'] });
  let installed = false;
  await page.route('**/api/setup/git', (route) =>
    route.fulfill({
      json: { installed, version: installed ? '2.47.1' : null, canInstall: true },
    }),
  );
  await page.route('**/api/setup/git/install', (route) =>
    route.fulfill({ json: { installed: false, version: null, canInstall: true } }),
  );
  await page.goto('/');
  await continueButton(page).click();
  const git = dialog(page).getByRole('region', { name: 'Git' });
  await expect(git).toContainText('Git not installed');
  await expect(git).toContainText('its own git worktree');
  await git.getByRole('button', { name: 'Install Xcode Command Line Tools' }).click();
  await expect(git).toContainText('Follow Apple’s installer');

  await continueFromTools(page, /all set/);
  await expect(dialog(page).locator('.done-list')).toContainText('Git not installed');
  await expect(dialog(page).locator('.done-list')).toContainText('Needed for Do chats');

  await backPastMacAccess(page);
  installed = true;
  await git.getByRole('button', { name: 'Check again' }).click();
  await expect(git).toContainText('Git 2.47.1');
  await continueFromTools(page, /all set/);
  await expect(dialog(page).locator('.done-list')).toContainText('Git 2.47.1');
  await dialog(page).getByRole('button', { name: 'Open Spark Outpost' }).click();
  await expect(page.locator('.onb')).toHaveCount(0);
});

test('each step centres its column in the panel and the footer lines up with it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const expectCentred = async () => {
    const body = await dialog(page).locator('.onb-body').boundingBox();
    const pane = await dialog(page).locator('.pane').boundingBox();
    const footer = await dialog(page).locator('.onb-foot-row').boundingBox();
    if (!body || !pane || !footer) throw new Error('onboarding layout is missing');
    expect(Math.abs(pane.x + pane.width / 2 - (body.x + body.width / 2))).toBeLessThan(10);
    expect(Math.abs(footer.x - pane.x)).toBeLessThan(2);
    expect(Math.abs(footer.width - pane.width)).toBeLessThan(2);
  };
  await nameField(page).fill('Hazel');
  await expectCentred();
  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Pick a theme' })).toBeVisible();
  await expect(dialog(page).locator('.pane')).toHaveCount(1);
  await expectCentred();
});

test('the Mac access step explains Full Disk Access and can be skipped', async ({ page }) => {
  await enterName(page, 'Hazel Morgan');
  const key = await openApiKeyTab(page);
  await key.fill(CLAUDE_KEY);
  await key.press('Enter');
  await expect(claudeCard(page)).toContainText('Connected · API key');
  await claudeCard(page).getByRole('button', { name: 'Done' }).click();
  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Bring in your tools' })).toBeVisible();

  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Mac access' })).toBeVisible();

  const card = dialog(page).getByRole('region', { name: 'Full Disk Access' });
  await expect(card).toContainText(
    'Stops macOS asking each time an agent reads a protected folder.',
  );
  await expect(card).toContainText('System Settings');
  await expect(card).toContainText("Spark's own approvals");
  await expect(dialog(page)).toContainText('Optional. You can do this later in Settings.');
  await shot(page, 'onboarding-mac-access', 'light');
  await shot(page, 'onboarding-mac-access', 'dark');

  await continueButton(page).click();
  await expect(dialog(page).getByRole('heading', { name: "You're all set, Hazel" })).toBeVisible();
});
