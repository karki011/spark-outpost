import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { expectNoSidewaysScroll, PHONE } from './responsive-kit.ts';
import { seedChats, type SeedApproval, type SeedChat } from './sidebar-seed.ts';

const SHOT = process.env.SUB_CHATS_SHOT ?? '';
const PROJECT = 'storefront';
const PARENT = 'Checkout rewrite';
const SKINS = { light: 'apricot', dark: 'graphite' } as const;
const STARTED_WITH = {
  provider: 'fake',
  model: 'sonnet',
  effort: 'medium',
  agentMode: 'auto',
  level: 'full-auto',
};

const question: SeedApproval = {
  kind: 'clarify',
  title: 'Round tax per line or per order?',
  checkpoint: {
    kind: 'clarify',
    question: 'Round tax per line or per order?',
    reason: 'The old code does both.',
  },
};

interface Piece extends SeedChat {
  started?: boolean;
  pullRequest?: number;
}

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

async function linkPieces(parent: string | null, title: string, pieces: readonly Piece[]) {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    for (const [position, piece] of pieces.entries()) {
      await db.query(
        `INSERT INTO sub_chats (conversation_id, parent_conversation_id, parent_title, position,
           task, started_at, started_with)
         VALUES ($1, $2, $3, $4, 'Build this piece.', CASE WHEN $5 THEN now() END, $6)`,
        [piece.id, parent, title, position, piece.started ?? true, JSON.stringify(STARTED_WITH)],
      );
      if (!piece.pullRequest) continue;
      await db.query(
        `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number,
           url, branch, pr_state, checks)
         VALUES ($1, $2, $3, 'github.com', 'acme', 'shop', $4, $5, 'spark/piece', 'open',
           'passing')`,
        [
          randomUUID(),
          workspaceId,
          piece.id,
          piece.pullRequest,
          `https://github.com/acme/shop/pull/${piece.pullRequest}`,
        ],
      );
    }
  } finally {
    await db.end();
  }
}

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

async function expectAccessible(page: Page, include: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
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

  const deleted = await page.request.delete(`/api/conversations/${parentId}`, { data: {} });
  expect(deleted.status()).toBe(204);
  await openChats(page);
  const left = project(page).locator('.row', { hasText: 'Checkout UI' });
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
