import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeConfiguredRepo } from '../../apps/server/test/repo-config-fixture.ts';
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
  const ignored = card(page, 'Ignored settings');
  await ignored.getByText('Show ignored settings').click();
  await expect(ignored).toContainText('Permission allow rules');
  await expect(ignored).toContainText('ANTHROPIC_BASE_URL');

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

test('fits a narrow window and a dark theme', async ({ page }) => {
  await chatWithRepo(page);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
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
