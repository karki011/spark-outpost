import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { expectNoSidewaysScroll, PHONE } from './responsive-kit.ts';
import { seedChats, type SeedApproval } from './sidebar-seed.ts';
import { linkPieces, seedPlanApproval, type Piece } from './sub-chats-seed.ts';

const SHOT = process.env.SUB_CHATS_SHOT ?? '';
const PROJECT = 'storefront';
const PARENT = 'Checkout rewrite';
const SKINS = { light: 'apricot', dark: 'graphite' } as const;
const question: SeedApproval = {
  kind: 'clarify',
  title: 'Round tax per line or per order?',
  checkpoint: {
    kind: 'clarify',
    question: 'Round tax per line or per order?',
    reason: 'The old code does both.',
  },
};

const PIECES: readonly Piece[] = [
  { title: 'Payments API v2', run: { status: 'succeeded' }, pullRequest: 412 },
  { title: 'Cart totals service', run: { status: 'awaiting_approval' }, approval: question },
  { title: 'Checkout UI', run: { status: 'running' } },
  { title: 'E2E checkout tests', started: false },
  { title: 'Old payments spike', run: { status: 'succeeded' }, archived: true },
];

let base = '';
let parentId = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-sub-chats-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openChats(page);
  const folder = path.join(mkdtempSync(path.join(base, 'p-')), PROJECT);
  mkdirSync(folder);
  const created = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(created.ok()).toBe(true);
  const { id: projectId } = (await created.json()) as { id: string };
  const inProject = { projectIds: [projectId] };
  const [parent, flaky, orphan, ...ids] = await seedChats([
    { title: PARENT, ...inProject, run: { status: 'succeeded' } },
    { title: 'Fix flaky login spec', ...inProject },
    { title: 'Search index rebuild', ...inProject, run: { status: 'succeeded' } },
    ...PIECES.map((piece) => ({ ...piece, ...inProject })),
  ]);
  if (!parent || !flaky || !orphan) throw new Error('The chats were not seeded.');
  parentId = parent;
  await linkPieces(
    parent,
    PARENT,
    PIECES.map((piece, index) => ({ ...piece, id: ids[index]! })),
  );
  await linkPieces(null, 'Catalog cleanup', [{ title: 'Search index rebuild', id: orphan }]);
  await openChats(page);
  await expect(subRows(page)).toHaveCount(4);
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const project = (page: Page) =>
  sidebar(page).locator('.pblock[data-project]', { hasText: PROJECT });
const tree = (page: Page) => sidebar(page).getByRole('list', { name: `Sub-chats of ${PARENT}` });
const subRows = (page: Page) => tree(page).locator('.row');
const fold = (page: Page) =>
  sidebar(page).getByRole('button', { name: `4 sub-chats of ${PARENT}` });
const rowButton = (page: Page, title: string) =>
  sidebar(page)
    .locator('.row-open')
    .and(page.getByRole('button', { name: new RegExp(`^${title}`) }));
const header = (page: Page) => page.locator('header.chat-head');
const crumb = (page: Page) => header(page).getByRole('navigation', { name: 'Parent chat' });

async function deleteFromMenu(page: Page, title: string): Promise<void> {
  await rowButton(page, title).hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for ${title}` })
    .click();
  const menu = page.getByRole('menu', { name: `Options for ${title}` });
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await menu.getByRole('menuitem', { name: 'Confirm delete' }).click();
}

async function watchParentMarks(page: Page, title: string): Promise<() => Promise<string[]>> {
  await page.evaluate((text) => {
    const marks = new Set<string>();
    const read = () => {
      for (const row of document.querySelectorAll('nav .row')) {
        if (!row.textContent?.includes(text)) continue;
        marks.add(
          (row.querySelector('.parent-mark')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        );
      }
    };
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    read();
    Object.assign(globalThis, { parentMarksSeen: marks });
  }, title);
  return () =>
    page.evaluate(() => [...(globalThis as { parentMarksSeen?: Set<string> }).parentMarksSeen!]);
}

async function expectAccessible(page: Page, include: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const found = results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id}: ${node.target.join(' ')} (${node.any[0]?.message ?? ''})`,
    ),
  );
  expect(found).toEqual([]);
}

test('sub-chats are nested under their parent in plan order, each with its status', async ({
  page,
}) => {
  await expect(subRows(page).locator('.tt')).toHaveText([
    'Payments API v2',
    'Cart totals service',
    'Checkout UI',
    'E2E checkout tests',
  ]);
  await expect(subRows(page).locator('.sub-status')).toHaveText([
    'Ready for review',
    'Needs you',
    'Working',
    'Held',
  ]);
  await expect(subRows(page).locator('.sub-status svg')).toHaveCount(4);
  await expect(project(page).locator('.tt', { hasText: 'Payments API v2' })).toHaveCount(1);
  await expect(project(page).locator('.row-tree > .row .tt')).toHaveText([PARENT]);
  await expect(rowButton(page, PARENT)).toHaveAccessibleName(/1 sub-chat needs you/);
  await expect(rowButton(page, 'Payments API v2')).toHaveAccessibleName(/Ready for review/);
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [theme, skin] of Object.entries(SKINS)) {
    await page.evaluate((value) => {
      document.documentElement.dataset.skin = value;
    }, skin);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await expectAccessible(page, 'nav.side');
    if (SHOT && theme === 'dark') await sidebar(page).screenshot({ path: SHOT });
  }
});

test('a parent folds and unfolds, by pointer and by keyboard, and remembers it', async ({
  page,
}) => {
  await fold(page).click();
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(subRows(page).first()).toBeHidden();
  await page.reload();
  await openChats(page);
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(subRows(page).first()).toBeHidden();

  await rowButton(page, PARENT).focus();
  await page.keyboard.press('ArrowRight');
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(subRows(page)).toHaveCount(4);
  await page.keyboard.press('ArrowRight');
  await expect(rowButton(page, 'Payments API v2')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(rowButton(page, PARENT)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
});

test('a folded parent unfolds when one of its sub-chats is opened', async ({ page }) => {
  await fold(page).click();
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await sidebar(page).getByRole('searchbox').fill('Cart totals');
  await sidebar(page)
    .locator('.row', { hasText: 'Cart totals service' })
    .locator('.row-open')
    .click();
  await sidebar(page).getByRole('searchbox').fill('');
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(subRows(page).filter({ hasText: 'Cart totals service' })).toHaveClass(/active/);
});

test('a narrow sidebar puts a sub-chat’s status under its title instead of cutting the title', async ({
  page,
}) => {
  const row = subRows(page).filter({ hasText: 'Payments API v2' });
  const title = row.locator('.tt');
  const status = row.locator('.sub-status');
  const fits = await title.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
  const [titleBox, statusBox] = [await title.boundingBox(), await status.boundingBox()];
  expect(statusBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 1);
  const short = subRows(page).filter({ hasText: 'Checkout UI' });
  const [shortTitle, shortStatus] = [
    await short.locator('.tt').boundingBox(),
    await short.locator('.sub-status').boundingBox(),
  ];
  expect(Math.abs(shortStatus!.y - shortTitle!.y)).toBeLessThan(shortTitle!.height);
});

test('a sub-chat opens from the tree and its header leads back to the parent', async ({ page }) => {
  await rowButton(page, 'Cart totals service').click();
  await expect(header(page).getByRole('heading', { level: 1 })).toHaveText('Cart totals service');
  await expect(header(page).locator('.sub-status')).toHaveText('Needs you');
  await expect(subRows(page).filter({ hasText: 'Cart totals service' })).toHaveClass(/active/);
  await expectAccessible(page, 'header.chat-head');
  await crumb(page)
    .getByRole('button', { name: `Back to ${PARENT}` })
    .click();
  await expect(header(page).getByRole('heading', { level: 1 })).toHaveText(PARENT);
  await expect(crumb(page)).toHaveCount(0);
  await expect(header(page).locator('.sub-status')).toHaveCount(0);
});

test('search and History list sub-chats flat, marked with their parent', async ({ page }) => {
  await sidebar(page).getByRole('searchbox').fill('Payments API');
  const found = sidebar(page).locator('.row', { hasText: 'Payments API v2' });
  await expect(found.locator('.parent-mark')).toHaveText(`↳ , sub-chat of ${PARENT}`);
  await expect(found.locator('.sub-status')).toHaveText('Ready for review');
  await expect(tree(page)).toHaveCount(0);
  await sidebar(page).getByRole('searchbox').fill('');
  await expect(subRows(page)).toHaveCount(4);

  await sidebar(page)
    .getByRole('tab', { name: /^History/ })
    .click();
  const archived = sidebar(page).locator('.row', { hasText: 'Old payments spike' });
  await expect(archived.locator('.parent-mark')).toHaveText(`↳ , sub-chat of ${PARENT}`);
  await expect(archived.locator('.sub-status')).toHaveText('Done');
});

test('a chat whose parent was deleted stays at the top and says what it was part of', async ({
  page,
}) => {
  const orphan = project(page).locator('.row', { hasText: 'Search index rebuild' });
  await expect(orphan.locator('.parent-mark')).toHaveText('· , was part of Catalog cleanup');
  await expect(tree(page).locator('.row', { hasText: 'Search index rebuild' })).toHaveCount(0);

  await seedPlanApproval(parentId);
  const left = project(page).locator('.row', { hasText: 'Checkout UI' });
  const deleted = page.getByRole('status').filter({ hasText: `Deleted ${PARENT}` });
  await deleteFromMenu(page, PARENT);
  await expect(left.locator('.parent-mark')).toHaveText(`· , was part of ${PARENT}`);
  await deleted.getByRole('button', { name: 'Undo' }).click();
  await expect(subRows(page)).toHaveCount(4);

  const gone = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().endsWith(`/api/conversations/${parentId}`),
    { timeout: 20_000 },
  );
  const search = sidebar(page).getByRole('searchbox');
  const found = sidebar(page).locator('.row', { hasText: 'Checkout UI' });
  await search.fill('Checkout');
  await expect(found.locator('.parent-mark')).toHaveText(`↳ , sub-chat of ${PARENT}`);
  await deleteFromMenu(page, PARENT);
  await expect(found.locator('.parent-mark')).toHaveText(`· , was part of ${PARENT}`);
  const marksSeen = await watchParentMarks(page, 'Checkout UI');
  expect((await gone).status()).toBe(204);
  await expect(deleted).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Could not delete' })).toHaveCount(0);
  await expect(rowButton(page, PARENT)).toHaveCount(0);
  await expect(found.locator('.parent-mark')).toHaveText(`· , was part of ${PARENT}`);
  await search.fill('');
  await expect(left.locator('.parent-mark')).toHaveText(`· , was part of ${PARENT}`);
  await expect(tree(page)).toHaveCount(0);
  expect(await marksSeen()).toEqual([`· , was part of ${PARENT}`]);
  await openChats(page);
  await expect(left.locator('.parent-mark')).toHaveText(`· , was part of ${PARENT}`);
  await expect(tree(page)).toHaveCount(0);
});

test('the breadcrumb and the tree fit a phone', async ({ page }) => {
  await rowButton(page, 'Cart totals service').click();
  await expect(crumb(page)).toBeVisible();
  await page.setViewportSize(PHONE);
  await expect(crumb(page).getByRole('button', { name: `Back to ${PARENT}` })).toBeVisible();
  await expect(header(page).locator('.sub-status')).toHaveText('Needs you');
  await expectNoSidewaysScroll(page);
  await page.getByRole('button', { name: /^(Show|Open) sidebar/ }).click();
  await expect(subRows(page)).toHaveCount(4);
  await expect(subRows(page).locator('.sub-status').first()).toBeVisible();
  await expectNoSidewaysScroll(page);
});
