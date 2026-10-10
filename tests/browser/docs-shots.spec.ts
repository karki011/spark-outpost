import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { pickerPanel, workPanel } from './permissions-kit.ts';
import { resetTestDatabase } from './database.ts';
import {
  assertDemoDatabase,
  DEMO_NAME,
  DEMO_PROJECT,
  demoRepo,
  seedDemo,
  shoot,
  useSystemTheme,
  type DemoRepo,
} from './docs-seed.ts';
import { openChats } from './navigation.ts';

const IMAGES = path.resolve('docs/guide/images');
const CLAUDE_KEY = `sk-ant-api03-${'a'.repeat(24)}4f2a`;

test.skip(!process.env.SPARK_DOCS_SHOTS, 'Run pnpm docs:screenshots to write the guide images.');

let repo: DemoRepo;

test.beforeEach(async ({ page }) => {
  repo = demoRepo();
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(() => repo.remove());

const onboarding = (page: Page) => page.locator('.onb');
const continueButton = (page: Page) => onboarding(page).getByRole('button', { name: 'Continue' });
const claudeCard = (page: Page) => onboarding(page).locator('.pconf[data-prov="claude"]');

test('Getting started screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  assertDemoDatabase();
  await resetTestDatabase({ onboarded: false });
  await page.goto('/');
  await expect(onboarding(page).getByRole('heading', { name: 'Meet Spark' })).toBeVisible();
  const name = onboarding(page).getByLabel('What should Spark call you?', { exact: true });
  await name.fill(DEMO_NAME);
  await expect(onboarding(page)).toContainText('Hi Maya 👋');
  await shoot(page, IMAGES, 'getting-started-meet-spark');

  await name.press('Enter');
  await expect(onboarding(page).getByRole('heading', { name: 'Pick a theme' })).toBeVisible();

  await continueButton(page).click();
  await onboarding(page).locator('.ptile[data-prov="claude"]').click();
  await claudeCard(page).getByRole('tab', { name: 'API key' }).click();
  await claudeCard(page).getByLabel('Claude API key').fill(CLAUDE_KEY);
  await expect(claudeCard(page)).toContainText('Looks right. Verify to finish connecting.');
  await shoot(page, IMAGES, 'getting-started-provider');

  await claudeCard(page).getByLabel('Claude API key').press('Enter');
  await expect(claudeCard(page)).toContainText('Connected');
  await claudeCard(page).getByRole('button', { name: 'Send test message' }).click();
  await expect(claudeCard(page)).toContainText('Test message answered', { timeout: 15_000 });
  const defaults = claudeCard(page).getByRole('region', { name: 'Defaults for new chats' });
  await expect(defaults.getByRole('button', { name: 'Claude model' })).toHaveText(
    'Claude Opus 5.5',
  );

  await continueButton(page).click();
  await expect(
    onboarding(page).getByRole('heading', { name: 'Bring in your tools' }),
  ).toBeVisible();
  await expect(onboarding(page).getByRole('region', { name: 'Git' })).toContainText('Found', {
    timeout: 15_000,
  });
  await shoot(page, IMAGES, 'getting-started-tools');

  await continueButton(page).click();
  const macAccess = onboarding(page).getByRole('heading', { name: 'Mac access' });
  const allSet = onboarding(page).getByRole('heading', { name: /all set, Maya/ });
  await expect(macAccess.or(allSet)).toBeVisible();
  if (await macAccess.isVisible()) await continueButton(page).click();
  await expect(allSet).toBeVisible();
  await shoot(page, IMAGES, 'getting-started-done');
});

async function newProjectChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByText('What should we work on?')).toBeVisible();
}

async function linkProject(page: Page) {
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${DEMO_PROJECT}`) }).click();
  await expect(menu.getByRole('list', { name: 'Linked repos' })).toContainText(DEMO_PROJECT);
  return menu;
}

test('Chats and modes screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await seedDemo(page, repo);
  await newProjectChat(page);
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('Add a dark mode toggle to the dashboard');
  await shoot(page, IMAGES, 'chats-and-modes-new-chat');
  await page.getByRole('textbox', { name: 'Message' }).fill('');

  await linkProject(page);
  await shoot(page, IMAGES, 'chats-and-modes-project');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await expect(pickerPanel(page).getByRole('radio', { name: /Opus 5\.5/ })).toBeVisible();
  await shoot(page, IMAGES, 'chats-and-modes-picker');

  await pickerPanel(page)
    .getByRole('tab', { name: /Permissions/ })
    .click();
  await expect(pickerPanel(page).getByRole('radiogroup', { name: 'Agent mode' })).toBeVisible();
  await shoot(page, IMAGES, 'chats-and-modes-permissions');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Spark autonomy: / }).click();
  await expect(workPanel(page).getByRole('radiogroup', { name: 'Spark autonomy' })).toBeVisible();
  await shoot(page, IMAGES, 'chats-and-modes-autonomy');
});

const waitingCard = (page: Page, card: RegExp) => page.getByRole('group', { name: card });

async function ask(page: Page, text: string, card: RegExp) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(waitingCard(page, card)).toBeVisible({ timeout: 20_000 });
}

async function answer(page: Page, card: RegExp, button: string) {
  await waitingCard(page, card).getByRole('button', { name: button, exact: true }).click();
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  if (await stop.isVisible()) await stop.click();
  await expect(stop).toBeHidden({ timeout: 20_000 });
}

test('Approvals screenshots', async ({ page }) => {
  test.setTimeout(180_000);
  await seedDemo(page, repo, { claudeMode: 'default' });
  const cards: [string, string, RegExp, string][] = [
    ['approvals-command', 'Run the tests #approve', /Run a command\?/, 'Allow'],
    ['approvals-edit', 'Add today to the checklist #edit', /Change a file\?/, 'Deny'],
    [
      'approvals-instructions',
      'Note the test command #instructions',
      /Change agent instructions\?/,
      'Deny',
    ],
    ['approvals-hold', 'Add a pre-commit hook #githook', /Change git hooks or config\?/, 'Deny'],
  ];
  for (const [shot, message, card, button] of cards) {
    await newProjectChat(page);
    await linkProject(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Permissions: / })).toHaveAccessibleName(
      'Permissions: Manual',
    );
    await ask(page, message, card);
    await shoot(page, IMAGES, shot, waitingCard(page, card));
    await answer(page, card, button);
  }

  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /Commands that run without asking/ }).click();
  await menu.getByLabel('Allow a command').fill('pnpm test');
  await menu.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(menu.getByRole('list', { name: /Allowed commands/ })).toContainText('pnpm test');
  await shoot(page, IMAGES, 'approvals-allowlist', menu);
});

test('Docs page review screenshots', async ({ page }) => {
  const folder = path.resolve('test-results/docs-review');
  await seedDemo(page, repo);
  await page.goto('/#/docs/answer-approvals#hold-to-confirm');
  await expect(page.getByRole('heading', { name: 'Hold to confirm', level: 2 })).toBeFocused();
  await shoot(page, folder, 'docs-how-to');
  await page.goto('/#/docs/welcome');
  await expect(
    page.getByRole('heading', { name: 'What do you want to do?', level: 1 }),
  ).toBeVisible();
  await shoot(page, folder, 'docs-landing');
  await page.goto('/#/docs/cards');
  await expect(page.getByRole('heading', { name: 'Cards', level: 1 })).toBeVisible();
  await shoot(page, folder, 'docs-reference');
  await page.goto('/#/docs/trouble-providers');
  await expect(page.getByRole('heading', { name: 'Providers and keys', level: 1 })).toBeVisible();
  await shoot(page, folder, 'docs-troubleshooting');
  await page.getByRole('searchbox', { name: 'Search the guide' }).fill('autonomy');
  await shoot(page, folder, 'docs-search');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/docs/start-a-chat');
  await shoot(page, folder, 'docs-phone');
});
