import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  NAME,
  TURN_TIMEOUT,
  openOutpost,
  openSettings,
  outpostPage,
  outpostRow,
  outpostsSection,
  post,
  say,
  sidebar,
  stateOf,
} from './outposts-kit.ts';
import { seedChats, type SeedApproval } from './sidebar-seed.ts';

const SHOTS = process.env.OUTPOST_SHOTS ?? '';
const PROJECT = 'orders-web';
const SKINS = { light: 'apricot', dark: 'graphite' } as const;

const question: SeedApproval = {
  kind: 'clarify',
  title: 'Which region?',
  checkpoint: { kind: 'clarify', question: 'Which region?', reason: 'Unclear.' },
};

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-outpost-sidebar-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

const project = (page: Page) =>
  sidebar(page).locator('.pblock[data-project]', { hasText: PROJECT });
const memberRows = (page: Page) => outpostsSection(page).locator('.row');
const memberRow = (page: Page, title: string) => memberRows(page).filter({ hasText: title });
const fold = (page: Page) =>
  outpostsSection(page).getByRole('button', { name: new RegExp(`chats? in ${NAME}$`) });
const openRow = (rows: Locator, title: string) =>
  rows.getByRole('button', { name: new RegExp(`^${title}`) });

async function seeded(page: Page, asking = false): Promise<void> {
  await openChats(page);
  const folder = path.join(mkdtempSync(path.join(base, 'p-')), PROJECT);
  mkdirSync(folder);
  const created = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(created.ok()).toBe(true);
  const { id: projectId } = (await created.json()) as { id: string };
  const waiting = asking
    ? { run: { status: 'awaiting_approval' }, approval: question, minutesAgo: 5 }
    : {};
  const [frontend, api] = await seedChats([
    { title: 'Frontend', projectIds: [projectId], ...waiting },
    { title: 'Orders API', projectIds: [projectId] },
    { title: 'Docs site', projectIds: [projectId] },
  ]);
  if (!frontend || !api) throw new Error('The chats were not seeded.');
  const outpost = await page.request.post('/api/outposts', {
    data: {
      id: randomUUID(),
      name: NAME,
      members: [
        { conversationId: frontend, handle: 'fe' },
        { conversationId: api, handle: 'api' },
      ],
    },
  });
  expect(outpost.ok()).toBe(true);
  await openChats(page);
  await expect(memberRows(page)).toHaveCount(2);
}

async function expectCollapsed(page: Page): Promise<void> {
  const body = outpostsSection(page).locator('.pbody');
  await expect(body).toHaveAttribute('inert', '');
  await expect
    .poll(() => body.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(0);
}

async function inSkins(page: Page, name: string, check: (theme: string) => Promise<void>) {
  for (const [theme, skin] of Object.entries(SKINS)) {
    await page.evaluate((value) => {
      document.documentElement.dataset.skin = value;
    }, skin);
    await page.waitForTimeout(400);
    await check(theme);
    if (SHOTS) {
      await sidebar(page).screenshot({ path: `${SHOTS}/outpost-sidebar-${name}-${theme}.png` });
    }
  }
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('nav.side')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

test('member chats are listed under their outpost and not under their project', async ({
  page,
}) => {
  await seeded(page);
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(memberRows(page).locator('.tt')).toHaveText(['Frontend', 'Orders API']);
  await expect(memberRow(page, 'Frontend').locator('.row-open')).toHaveAccessibleName(/, @fe/);
  await expect(memberRow(page, 'Orders API').locator('.row-open')).toHaveAccessibleName(/, @api/);
  await expect(memberRow(page, 'Frontend').locator('.chat-face')).toBeVisible();
  await expect(outpostRow(page, NAME)).toHaveAccessibleName(NAME);
  await expect(fold(page)).toHaveAccessibleName(`2 chats in ${NAME}`);

  await expect(project(page).locator('.row .tt')).toHaveText(['Docs site']);
  await expect(project(page).getByLabel('1 chat', { exact: true })).toHaveText('1');
  await expect(sidebar(page).getByRole('tab', { name: /^Active/ })).toContainText('3');
  await expect(sidebar(page).locator('.row', { hasText: 'Frontend' })).toHaveCount(1);

  await inSkins(page, 'expanded', () => expectAccessible(page));
});

test('an outpost collapses, remembers it, and a member row opens its chat', async ({ page }) => {
  await seeded(page);
  await fold(page).click();
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await expectCollapsed(page);
  await inSkins(page, 'collapsed', () => expectAccessible(page));

  await page.reload();
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await expectCollapsed(page);
  await expect(project(page).locator('.row .tt')).toHaveText(['Docs site']);

  await fold(page).click();
  await expect(memberRow(page, 'Orders API')).toBeVisible();
  await page.reload();
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'true');

  await openRow(memberRows(page), 'Orders API').click();
  await expect(page.locator('.chat-title')).toHaveText('Orders API');
  await expect(openRow(memberRows(page), 'Orders API')).toHaveAttribute('aria-current', 'page');

  await openOutpost(page);
  await expect(outpostRow(page, NAME)).toHaveAttribute('aria-current', 'page');
  await expect(memberRows(page)).toHaveCount(2);
});

test('a chat that leaves its outpost returns to its project', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  const dialog = await openSettings(page, NAME);
  await dialog.getByRole('button', { name: 'Remove Frontend' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect(memberRows(page).locator('.tt')).toHaveText(['Orders API']);
  await expect(project(page).locator('.row .tt')).toHaveText(['Frontend', 'Docs site'], {
    ignoreCase: true,
  });
  await expect(project(page).locator('.row-open[title*="@"]')).toHaveCount(0);
  await expect(project(page).getByLabel('2 chats', { exact: true })).toHaveText('2');
});

test('search, the row menu and History reach a member chat', async ({ page }) => {
  await seeded(page);
  const search = sidebar(page).getByRole('searchbox');
  await search.fill('Orders API');
  await expect(memberRows(page).locator('.tt')).toHaveText(['Orders API']);
  await expect(project(page)).toHaveCount(0);
  await search.fill('Docs site');
  await expect(outpostsSection(page)).toHaveCount(0);
  await expect(project(page).locator('.row .tt')).toHaveText(['Docs site']);
  await search.fill('');
  await expect(memberRows(page)).toHaveCount(2);

  await memberRow(page, 'Frontend').hover();
  await memberRow(page, 'Frontend').getByRole('button', { name: 'Options for Frontend' }).click();
  const menu = page.getByRole('menu', { name: 'Options for Frontend' });
  await expect(menu.getByRole('menuitem', { name: 'Add to outpost' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Move to project' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(memberRows(page).locator('.tt')).toHaveText(['Orders API']);
  await expect(project(page).locator('.row .tt')).toHaveText(['Docs site']);

  await sidebar(page)
    .getByRole('tab', { name: /^History/ })
    .click();
  await expect(sidebar(page).locator('.row', { hasText: 'Frontend' })).toBeVisible();
});

test('the keyboard walks the outpost, its chats and their menus in order', async ({ page }) => {
  await seeded(page);
  await fold(page).focus();
  await expect(fold(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(outpostRow(page, NAME)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(openRow(memberRows(page), 'Frontend')).toBeFocused();
  const ring = await openRow(memberRows(page), 'Frontend').evaluate(
    (element) => getComputedStyle(element).outlineStyle,
  );
  expect(ring).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(sidebar(page).getByRole('button', { name: 'Options for Frontend' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(openRow(memberRows(page), 'Orders API')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-title')).toHaveText('Orders API');

  await fold(page).focus();
  await page.keyboard.press('Enter');
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(fold(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(outpostRow(page, NAME)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sidebar(page).getByRole('button', { name: 'Add project' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(outpostPage(page, NAME)).toBeVisible();
});

test('a member that needs you shows it on its row and on the collapsed outpost', async ({
  page,
}) => {
  await seeded(page, true);
  const frontend = memberRow(page, 'Frontend');
  await expect(frontend).toHaveClass(/st-asking/);
  await expect(frontend.getByRole('img', { name: 'Waiting for you' })).toBeVisible();
  await expect(frontend.locator('.row-open')).toHaveAttribute('title', /@fe/);

  await openOutpost(page);
  await say(page, '@api Deploy the orders service\n\nNeeds you: which region?\n\nThanks');
  await expect(stateOf(post(page, 'Deploy the orders service'))).toHaveText('Waiting on you', {
    timeout: TURN_TIMEOUT,
  });
  await expect(outpostRow(page, NAME)).toHaveAccessibleName(`${NAME}, 1 needs you`);
  await inSkins(page, 'needs-you', () => expectAccessible(page));

  await fold(page).click();
  await expectCollapsed(page);
  await expect(outpostRow(page, NAME)).toHaveAccessibleName(`${NAME}, 1 needs you`);
  await expect(outpostRow(page, NAME).locator('.op-needs')).toHaveText('1');
  await inSkins(page, 'needs-you-collapsed', async () => {});
});
