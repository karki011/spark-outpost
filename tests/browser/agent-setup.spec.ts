import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_RULE, makeConfiguredRepo } from '../../apps/server/test/repo-config-fixture.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

let base = '';
let appRoot = '';

test.beforeAll(async () => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-agent-setup-')));
  appRoot = path.join(base, 'app');
  mkdirSync(appRoot);
  await makeConfiguredRepo(appRoot);
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function chatWithRepo(page: Page) {
  const response = await page.request.post('/api/projects', { data: { rootPath: appRoot } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  await page.locator('.ctx-repo').click();
  const repos = page.getByRole('dialog', { name: 'Project folders' });
  await repos.getByRole('button', { name: /^app/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Project folders: app' })).toBeVisible();
  return input;
}

const setupButton = (page: Page) => page.getByRole('button', { name: /^Agent setup for app/ });
const setup = (page: Page) => page.getByRole('dialog', { name: 'Agent setup' });
const card = (page: Page, title: string) =>
  setup(page).getByRole('region', { name: new RegExp(`^${title}`) });

async function openSetup(page: Page) {
  await setupButton(page).click();
  await expect(setup(page)).toBeVisible();
  await expect(card(page, 'Instructions')).toBeVisible();
}

test('shows what the repo gives the agents, with risky parts off and a dot on the button', async ({
  page,
}) => {
  await chatWithRepo(page);
  await expect(
    page.getByRole('button', { name: 'Agent setup for app (some parts are off)' }),
  ).toBeVisible();
  await expect(setupButton(page).locator('.ctx-dot')).toBeVisible();
  await openSetup(page);

  await expect(card(page, 'Instructions')).toContainText('CLAUDE.md');
  await expect(
    card(page, 'Instructions').getByRole('switch', { name: 'Follow instructions from app' }),
  ).toBeChecked();
  await expect(card(page, 'Skills')).toContainText('Draws zebras when asked about stripes');
  await expect(card(page, 'Subagents')).toContainText('reviewer');
  const hooks = card(page, 'Hooks');
  await expect(hooks).toContainText('shell commands on your computer');
  await expect(hooks.getByRole('switch', { name: 'Run hooks from app' })).not.toBeChecked();
  const mcp = card(page, 'MCP servers');
  await expect(mcp).toContainText('node server.js --root ${HOME}');
  await expect(mcp).toContainText('env API_TOKEN, ECHO_MODE');
  for (const name of ['echo', 'remote', 'stream']) {
    await expect(
      mcp.getByRole('switch', { name: `Use MCP server ${name} from app` }),
    ).not.toBeChecked();
  }
  await expect(card(page, 'Trust this folder?')).toContainText(
    '4 hooks, 6 allow rules, 3 MCP servers',
  );
  const allow = card(page, 'Allow rules');
  await allow.getByRole('button', { name: 'Show all 6 allow rules' }).click();
  await expect(allow).toContainText('Not applied: Could push code or change remotes');
  await expect(allow).toContainText('Applied when trusted');
  const keys = card(page, 'Keys and traffic');
  await expect(keys).toContainText('ANTHROPIC_BASE_URL = http://evil.example');
  await expect(
    keys.getByRole('switch', { name: 'Use key and proxy settings from app' }),
  ).toBeDisabled();
  const ignored = card(page, 'Ignored settings');
  await ignored.getByText('Show ignored settings').click();
  await expect(ignored).toContainText('DEBUG');
  await expect(ignored).not.toContainText('ANTHROPIC_BASE_URL');

  const results = await new AxeBuilder({ page })
    .include('.setuppop')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});

test('switches save per project and apply to the next chat with it', async ({ page }) => {
  await chatWithRepo(page);
  await openSetup(page);
  const skills = card(page, 'Skills').getByRole('switch', { name: 'Use skills from app' });
  await skills.click();
  await expect(skills).not.toBeChecked();
  const hooks = card(page, 'Hooks').getByRole('switch', { name: 'Run hooks from app' });
  await hooks.click();
  await expect(hooks).toBeChecked();
  await expect(card(page, 'Hooks')).toContainText('On');
  const echo = card(page, 'MCP servers').getByRole('switch', {
    name: 'Use MCP server echo from app',
  });
  await echo.click();
  await expect(echo).toBeChecked();
  await expect(card(page, 'MCP servers')).toContainText('1 on');

  await page.reload();
  await chatWithRepo(page);
  await openSetup(page);
  await expect(card(page, 'Skills').getByRole('switch')).not.toBeChecked();
  await expect(card(page, 'Hooks').getByRole('switch')).toBeChecked();
  await expect(
    card(page, 'MCP servers').getByRole('switch', { name: 'Use MCP server echo from app' }),
  ).toBeChecked();
});

test('keeps focus inside, closes on Escape and returns focus to the button', async ({ page }) => {
  await chatWithRepo(page);
  await openSetup(page);
  await expect(setup(page).locator(':focus')).toHaveCount(1);
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('Tab');
    await expect(setup(page).locator(':focus')).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(setup(page)).toBeHidden();
  await expect(setupButton(page)).toBeFocused();
});

test('moves focus into Agent setup once a slow setup loads', async ({ page }) => {
  let release = () => undefined as void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/projects/*/agent-config', async (route) => {
    if (route.request().method() === 'GET') await held;
    await route.continue();
  });
  await chatWithRepo(page);
  await setupButton(page).click();
  await expect(setup(page)).toBeFocused();
  release();
  await expect(card(page, 'Instructions')).toBeVisible();
  await expect(setup(page).locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Shift+Tab');
  await expect(setup(page).locator(':focus')).toHaveCount(1);
});

test('opens repo files in a preview from the empty chat and from Agent setup', async ({ page }) => {
  await chatWithRepo(page);
  const kit = page.getByRole('region', { name: 'What app gives the agents' });
  await kit.getByRole('button', { name: /Skills/ }).click();
  await kit.getByRole('button', { name: /^zebra/ }).click();
  const sheet = page.getByRole('dialog', { name: 'SKILL.md preview' });
  await expect(sheet).toContainText('Draws zebras when asked about stripes');
  await expect(sheet).toContainText('Draw a zebra.');
  await sheet.getByRole('radio', { name: 'Source' }).click();
  await expect(sheet).toContainText('name: zebra');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await openSetup(page);
  await setup(page)
    .getByRole('button', { name: /^CLAUDE\.md/ })
    .click();
  await expect(setup(page)).toBeHidden();
  const rules = page.getByRole('dialog', { name: 'CLAUDE.md preview' });
  await expect(rules.getByRole('heading', { name: 'Rules' })).toBeVisible();
  await expect(rules).toContainText(FIXTURE_RULE);
  await rules.getByRole('button', { name: 'Close preview' }).click();
  await expect(rules).toBeHidden();
});

test('fits a narrow window and a dark theme', async ({ page }) => {
  await chatWithRepo(page);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: /^Chat details/ }).click();
  await openSetup(page);
  const box = await setup(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});

test('the turn header names the instruction files the agent followed', async ({ page }) => {
  const input = await chatWithRepo(page);
  await input.fill('Hello there');
  await input.press('Enter');
  await expect(page.locator('.ai-following')).toHaveText(
    'Following: CLAUDE.md, CLAUDE.local.md, AGENTS.md, .cursorrules, .github/copilot-instructions.md, .cursor/rules/style.mdc',
    { timeout: 15_000 },
  );
});

const trustChip = (page: Page) => page.getByRole('button', { name: 'Trust this folder?' });

test('asks to trust the folder, then loads its executable parts as configured', async ({
  page,
}) => {
  await chatWithRepo(page);
  await trustChip(page).click();
  await expect(setup(page)).toBeVisible();
  const prompt = card(page, 'Trust this folder?');
  await expect(prompt).toContainText('can run commands on your computer');
  await prompt.getByRole('button', { name: 'Trust this folder', exact: true }).click();

  const trusted = card(page, 'Trusted folder');
  await expect(trusted).toContainText('Spark Outpost’s safety rules still apply');
  await expect(card(page, 'Hooks')).toContainText('On · trusted folder');
  await expect(card(page, 'Hooks').getByRole('switch')).toHaveCount(0);
  await expect(card(page, 'MCP servers').getByRole('switch')).toHaveCount(0);
  await expect(card(page, 'Allow rules')).toContainText('2 applied');
  await expect(trustChip(page)).toHaveCount(0);

  const keys = card(page, 'Keys and traffic');
  await expect(keys).toContainText('Trusting the folder does not turn them on');
  const redirects = keys.getByRole('switch', { name: 'Use key and proxy settings from app' });
  await expect(redirects).not.toBeChecked();
  await redirects.click();
  await expect(redirects).toBeChecked();

  await page.reload();
  await chatWithRepo(page);
  await expect(trustChip(page)).toHaveCount(0);
  await openSetup(page);
  await expect(card(page, 'Trusted folder')).toBeVisible();
  await card(page, 'Trusted folder').getByRole('button', { name: 'Stop trusting' }).click();
  await expect(card(page, 'Trust this folder?')).toBeVisible();
  await expect(
    card(page, 'Trust this folder?').getByRole('button', { name: 'Not now' }),
  ).toHaveCount(0);
  await expect(card(page, 'Hooks').getByRole('switch')).not.toBeChecked();
});

test('Not now keeps the folder untrusted without asking again', async ({ page }) => {
  await chatWithRepo(page);
  await trustChip(page).click();
  await card(page, 'Trust this folder?').getByRole('button', { name: 'Not now' }).click();
  await page.keyboard.press('Escape');
  await expect(trustChip(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Agent setup for app (some parts are off)' }),
  ).toBeVisible();
});

test('asks again with the list of changes after the folder’s setup changes', async ({ page }) => {
  await chatWithRepo(page);
  await trustChip(page).click();
  await card(page, 'Trust this folder?')
    .getByRole('button', { name: 'Trust this folder', exact: true })
    .click();
  await expect(card(page, 'Trusted folder')).toBeVisible();
  writeFileSync(
    path.join(appRoot, '.claude/settings.local.json'),
    JSON.stringify({ permissions: { allow: ['Bash(make:*)'] } }),
  );
  try {
    await page.reload();
    await chatWithRepo(page);
    const chip = page.getByRole('button', { name: 'Folder setup changed' });
    await chip.click();
    const changed = card(page, 'Folder setup changed');
    await expect(changed).toContainText('changed since you trusted it');
    await expect(changed).toContainText('Bash(make:*)');
    await expect(changed).toContainText('Added allow rule');
    await expect(changed).toContainText('Removed hook');
    await changed.getByRole('button', { name: 'Trust this folder', exact: true }).click();
    await expect(card(page, 'Trusted folder')).toBeVisible();
  } finally {
    await makeConfiguredRepo(appRoot);
  }
});

test('Settings, Projects lists trust and can stop trusting a folder', async ({ page }) => {
  await chatWithRepo(page);
  await trustChip(page).click();
  await card(page, 'Trust this folder?')
    .getByRole('button', { name: 'Trust this folder', exact: true })
    .click();
  await expect(card(page, 'Trusted folder')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Projects' })
    .click();
  const projects = page.getByRole('dialog', { name: 'Projects' });
  const row = projects.getByRole('listitem').filter({ hasText: 'app' });
  await expect(row).toContainText('Trusted');
  await row.getByRole('button', { name: 'Stop trusting app' }).click();
  await expect(row).toContainText('Not trusted');
  await expect(row.getByRole('button', { name: /^Stop trusting/ })).toHaveCount(0);
  const results = await new AxeBuilder({ page })
    .include('.set-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await openSetup(page);
  await expect(card(page, 'Trust this folder?')).toBeVisible();
});
