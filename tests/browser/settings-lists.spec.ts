import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';

const NAMES = [
  'api',
  'auth',
  'billing-reconciliation-service',
  'cli',
  'customer-support-console-frontend',
  'data-pipeline',
  'design-system',
  'docs',
  'infra-terraform-modules-and-runbooks',
  'ios',
  'marketing-site',
  'ml-ranking',
  'mobile-android',
  'spark-outpost',
  'web',
];
const WITH_PREVIEW = new Set(['auth', 'docs', 'web']);
const THEMES = ['light', 'graphite', 'void', 'contrast', 'apricot', 'plum'];

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-settings-lists-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

async function linkProjects(page: Page, names: readonly string[]) {
  const group = path.join(base, String(names.length));
  for (const name of names) {
    const root = path.join(group, name);
    mkdirSync(root, { recursive: true });
    const linked = await page.request.post('/api/projects', { data: { rootPath: root } });
    expect(linked.ok()).toBe(true);
  }
  const db = openTestDb();
  try {
    for (const name of names.filter((candidate) => WITH_PREVIEW.has(candidate))) {
      await db.query('UPDATE projects SET preview = $1 WHERE root_path = $2', [
        JSON.stringify({ command: 'pnpm dev', url: 'http://localhost:5173' }),
        path.join(group, name),
      ]);
    }
  } finally {
    await db.end();
  }
}

async function openSection(page: Page, tab: string | RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Spark' }).getByRole('tab', { name: tab }).click();
  return page.getByRole('dialog');
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('.set-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' ')}`);
}

async function inEveryTheme(page: Page, screen: string) {
  const found: string[] = [];
  for (const theme of THEMES) {
    await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
    await animationsSettled(page);
    found.push(...(await seriousViolations(page)).map((line) => `${theme} ${screen} ${line}`));
  }
  expect(found).toEqual([]);
}

const row = (dialog: Locator, name: string) =>
  dialog.getByRole('button', { name: new RegExp(`^${name}\\b`) });

test('Settings names the teammates section Crew and keeps Spark for app behaviour', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const dialog = await openSection(page, 'Crew');
  const tabs = dialog.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab');
  await expect(tabs.nth(0)).toHaveText('Spark');
  await expect(tabs.nth(1)).toHaveText('Crew');
  await expect(dialog.getByRole('tab', { name: 'Sparks' })).toHaveCount(0);
  const teammates = page.getByRole('dialog', { name: 'Crew' });
  await expect(teammates.getByRole('heading', { name: 'Crew' })).toBeVisible();
  await expect(teammates.getByRole('button', { name: 'New Spark' })).toBeVisible();
});

test('fifteen projects fit a compact list that filters and opens one at a time', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetTestDatabase({ onboarded: true });
  await linkProjects(page, NAMES);
  const dialog = await openSection(page, 'Projects');
  const list = dialog.getByRole('list', { name: 'Linked folders' });
  await expect(list.locator('> li')).toHaveCount(15);
  await expect(dialog.locator('.set-projects-bar').getByRole('status')).toHaveText('15 projects');
  await expect(dialog.getByRole('group', { name: /^Work place in / })).toHaveCount(0);
  const body = dialog.locator('.set-body');
  expect(await body.evaluate((node) => node.scrollHeight)).toBeLessThan(900);
  expect(await body.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(row(dialog, 'auth')).toContainText('Preview');
  await expect(row(dialog, 'api')).not.toContainText('Preview');

  const design = row(dialog, 'design-system');
  await design.focus();
  await page.keyboard.press('Enter');
  await expect(design).toHaveAttribute('aria-expanded', 'true');
  const open = dialog.getByRole('group', { name: 'Settings for design-system' });
  await expect(open.getByRole('group', { name: 'Work place in design-system' })).toBeVisible();
  await expect(open.getByRole('group', { name: 'Browser in design-system' })).toBeVisible();
  await expect(
    open.getByRole('button', { name: 'Set up the preview of design-system' }),
  ).toBeVisible();
  await expect(open).toContainText(path.join(base, '15', 'design-system'));

  await row(dialog, 'web').click();
  await expect(design).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByRole('group', { name: /^Settings for / })).toHaveCount(1);
  await expect(
    dialog.getByRole('button', { name: 'Edit the preview of web' }),
  ).toHaveAccessibleDescription('Spark runs pnpm dev and opens http://localhost:5173.');

  await body.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  const filter = dialog.getByRole('searchbox', { name: 'Filter projects' });
  await expect(filter).toBeInViewport();
  await filter.fill('SERVICE');
  await expect(list.locator('> li')).toHaveCount(1);
  await expect(row(dialog, 'billing-reconciliation-service')).toBeVisible();
  await expect(dialog.locator('.set-projects-bar').getByRole('status')).toHaveText(
    '1 of 15 projects',
  );
  await filter.fill('nothing-like-this');
  await expect(dialog.getByText('No projects match “nothing-like-this”.')).toBeVisible();
  await filter.fill('');
  await expect(list.locator('> li')).toHaveCount(15);
  await expect(row(dialog, 'web')).toHaveAttribute('aria-expanded', 'true');

  await page.mouse.move(0, 0);
  await inEveryTheme(page, 'projects');
});

test('one project starts closed, opens from the keyboard, and a few show no filter', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await linkProjects(page, ['api']);
  const one = await openSection(page, 'Projects');
  const api = row(one, 'api');
  await expect(api).toHaveAttribute('aria-expanded', 'false');
  await expect(one.getByRole('group', { name: /^Settings for / })).toHaveCount(0);
  await expect(one.getByRole('searchbox', { name: 'Filter projects' })).toHaveCount(0);
  await api.focus();
  await page.keyboard.press('Space');
  await expect(api).toHaveAttribute('aria-expanded', 'true');
  await expect(one.getByRole('group', { name: 'Work place in api' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(api).toHaveAttribute('aria-expanded', 'false');
  await expect(one.getByRole('group', { name: 'Work place in api' })).toHaveCount(0);
  await api.click();
  await expect(api).toHaveAttribute('aria-expanded', 'true');

  await resetTestDatabase({ onboarded: true });
  await linkProjects(page, ['api', 'cli', 'web']);
  const three = await openSection(page, 'Projects');
  await expect(three.getByRole('list', { name: 'Linked folders' }).locator('> li')).toHaveCount(3);
  await expect(three.getByRole('group', { name: /^Work place in / })).toHaveCount(0);
  await expect(three.getByRole('searchbox', { name: 'Filter projects' })).toHaveCount(0);
});

test('settings cards have no outer border and the last provider row follows the card corners', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
  const dialog = await openSection(page, /^AI providers/);
  const borderColor = (locator: Locator) =>
    locator.evaluate((node) => getComputedStyle(node).borderTopColor);
  const clear = 'rgba(0, 0, 0, 0)';
  const tile = dialog.locator('.ptile[data-prov="claude"]');
  await expect(tile).toContainText('Connected');
  expect(await borderColor(tile)).toBe(clear);
  await tile.click();
  const claude = dialog.locator('.pconf[data-prov="claude"]');
  expect(await borderColor(claude)).toBe(clear);

  const danger = claude.getByRole('button', { name: /^Danger zone/ });
  const corners = () =>
    danger.evaluate((button) => {
      const style = getComputedStyle(button);
      const card = getComputedStyle(button.closest('.pconf')!);
      return {
        left: parseFloat(style.borderBottomLeftRadius),
        right: parseFloat(style.borderBottomRightRadius),
        card: parseFloat(card.borderBottomLeftRadius),
      };
    });
  const closed = await corners();
  expect(closed.left).toBe(closed.card - 1);
  expect(closed.right).toBe(closed.card - 1);
  await danger.focus();
  expect((await corners()).left).toBe(closed.card - 1);
  await page.keyboard.press('Enter');
  await expect(danger).toHaveAttribute('aria-expanded', 'true');
  expect((await corners()).left).toBeLessThan(closed.card - 1);
  await page.keyboard.press('Enter');
  await page.mouse.move(0, 0);
  await inEveryTheme(page, 'provider');

  await dialog.getByRole('tab', { name: 'Models' }).click();
  const models = page.getByRole('dialog', { name: 'Models' });
  await models.getByRole('button', { name: /^Sonnet 5 / }).click();
  await page.mouse.move(0, 0);
  await inEveryTheme(page, 'models');

  for (const [tab, card] of [
    ['Appearance', '.tcard'],
    ['Reset', '.reset-list'],
    ['Crew', '.tm-starter'],
  ] as const) {
    await page.getByRole('dialog').getByRole('tab', { name: tab }).click();
    const first = page.getByRole('dialog', { name: tab }).locator(card).first();
    await expect(first).toBeVisible();
    expect(await borderColor(first)).toBe(clear);
  }
  await page.getByRole('dialog').getByRole('tab', { name: 'Appearance' }).click();
  const themes = page.getByRole('dialog', { name: 'Appearance' });
  const chosen = themes.getByRole('radio', { checked: true });
  await expect(chosen).toHaveCount(1);
  expect(await chosen.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe('none');
});
