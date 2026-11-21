import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { asPairedPhone } from './paired-phone.ts';
import { expectNoSidewaysScroll, PHONE } from './responsive-kit.ts';
import { seedChats, type SeedApproval } from './sidebar-seed.ts';
import {
  firstTurn,
  linkPieces,
  markChatTurn,
  seedAsk,
  seedChatTurn,
  seedStartedLine,
  seedTask,
  type Piece,
} from './sub-chats-seed.ts';

const SHOT = process.env.SUB_CHATS_TAB_SHOT ?? '';
const PROJECT = 'storefront';
const PARENT = 'Checkout rewrite';
const SKINS = { light: 'apricot', dark: 'graphite' } as const;
const CART_TASK =
  'Move cart totals into their own service behind totals/. Keep the public API of cart.ts unchanged.';
const claude = (model: string, effort: string) => ({ provider: 'claude', model, effort });

const question: SeedApproval = {
  kind: 'clarify',
  title: 'Round tax per line or per order?',
  checkpoint: {
    kind: 'clarify',
    question: 'Round tax per line or per order?',
    reason: 'The old code does both.',
  },
};

const REPORT = {
  status: 'ready_for_review',
  reason: null,
  changed: 'New payments/v2 client, 14 files, old client kept behind a flag',
  risks: 'Refund path is untested against the sandbox',
  blockers: '',
  branch: 'spark/payments-api-v2',
  committed: true,
  pushed: true,
  pullRequest: {
    number: 412,
    url: 'https://github.com/acme/shop/pull/412',
    state: 'open',
    checks: 'passing',
  },
};

const PIECES: readonly Piece[] = [
  {
    title: 'Payments API v2',
    run: { status: 'succeeded' },
    pullRequest: 412,
    branch: 'spark/payments-api-v2',
    startedWith: claude('opus[1m]', 'high'),
    report: REPORT,
  },
  {
    title: 'Cart totals service',
    run: { status: 'awaiting_approval' },
    approval: question,
    task: CART_TASK,
    message: CART_TASK,
    startedWith: claude('sonnet', 'medium'),
  },
  {
    title: 'Checkout UI',
    run: { status: 'running' },
    branch: 'spark/checkout-ui',
    stackedOn: 'Payments API v2',
    startedWith: claude('sonnet', 'medium'),
  },
  {
    title: 'E2E checkout tests',
    started: false,
    startsAfter: ['Payments API v2', 'Cart totals service', 'Checkout UI'],
    startedWith: claude('haiku', 'low'),
  },
];

let base = '';
let ids: Record<string, string> = {};
let parentId = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-sub-chats-tab-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

async function seedMessages(parent: string) {
  const cart = ids['Cart totals service']!;
  const payments = ids['Payments API v2']!;
  const checkout = ids['Checkout UI']!;
  const parentTurn = await firstTurn(parent);
  const cartTurn = await firstTurn(cart);
  const from = { id: parent, title: PARENT };
  await seedStartedLine(
    parentTurn.runId,
    PIECES.map((piece) => ({
      id: ids[piece.title]!,
      title: piece.title,
      held: piece.started === false,
    })),
  );
  await markChatTurn(cartTurn.runId);
  await seedAsk({
    id: cartTurn.messageId,
    kind: 'task',
    from,
    to: cart,
    body: CART_TASK,
    state: 'waiting',
    deliveredAs: 'turn',
    runId: cartTurn.runId,
  });
  const asked = await seedAsk({
    kind: 'message',
    from,
    fromRunId: parentTurn.runId,
    to: cart,
    body: 'Is the tax table shared with invoices?',
    state: 'replied',
    deliveredAs: 'steer',
    runId: cartTurn.runId,
  });
  await seedAsk({
    kind: 'reply',
    from: { id: cart, title: 'Cart totals service' },
    fromRunId: cartTurn.runId,
    to: parent,
    body: 'Yes, invoices read the same table.',
    replyTo: asked,
    deliveredAs: 'steer',
    runId: parentTurn.runId,
  });
  for (const body of ['Use the v2 client from the payments branch.', 'Keep the old form too.']) {
    await seedAsk({
      kind: 'message',
      from,
      fromRunId: parentTurn.runId,
      to: checkout,
      body,
      deliveredAs: 'turn',
    });
  }
  const reported = await seedChatTurn(
    parent,
    'Report from Payments API v2',
    'The API piece is ready and Checkout UI has started on top of it.',
  );
  await seedAsk({
    id: reported.messageId,
    kind: 'report',
    from: { id: payments, title: 'Payments API v2' },
    to: parent,
    body: 'Report from Payments API v2',
    deliveredAs: 'turn',
    runId: reported.runId,
    report: REPORT,
  });
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await page.setViewportSize({ width: 1500, height: 950 });
  await openChats(page);
  const folder = path.join(mkdtempSync(path.join(base, 'p-')), PROJECT);
  mkdirSync(folder);
  const created = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(created.ok()).toBe(true);
  const { id: projectId } = (await created.json()) as { id: string };
  const inProject = { projectIds: [projectId] };
  const [parent, ...pieceIds] = await seedChats([
    { title: PARENT, ...inProject, run: { status: 'succeeded' } },
    ...PIECES.map((piece) => ({ ...piece, ...inProject })),
  ]);
  if (!parent) throw new Error('The chats were not seeded.');
  ids = Object.fromEntries(PIECES.map((piece, index) => [piece.title, pieceIds[index]!]));
  await linkPieces(
    parent,
    PARENT,
    PIECES.map((piece) => ({ ...piece, id: ids[piece.title]! })),
    { projectId, folder },
  );
  await seedMessages(parent);
  parentId = parent;
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const rowButton = (page: Page, title: string) =>
  sidebar(page)
    .locator('.row-open')
    .and(page.getByRole('button', { name: new RegExp(`^${title}`) }));
const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });
const thread = (page: Page) => page.getByRole('main');
const group = (page: Page, name: string) => panel(page).getByRole('region', { name });
const startedLine = (page: Page) => thread(page).locator('.sc-started-line');

async function openParent(page: Page) {
  await openChats(page);
  await rowButton(page, PARENT).click();
  await expect(startedLine(page)).toBeVisible();
}

async function openTab(page: Page) {
  await seedTask(parentId, 'Rewrite checkout');
  await openParent(page);
  await startedLine(page).getByRole('button', { name: 'Open the Sub-chats tab' }).click();
  await expect(panel(page).getByRole('tab', { name: 'Sub-chats' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

async function expectAccessible(page: Page, include: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

test('the Sub-chats tab groups the sub-chats by status and shows each row’s facts', async ({
  page,
}) => {
  await openParent(page);
  await expect(startedLine(page)).toContainText(
    'Started 4 sub-chats: Payments API v2, Cart totals service, Checkout UI, E2E checkout tests',
  );
  await openTab(page);
  await expect(panel(page).locator('.scp-group h3')).toHaveText([
    'Needs you · 1',
    'Ready for review · 1',
    'Working · 1',
    'Held · 1',
  ]);
  const needs = group(page, 'Needs you 1');
  await expect(needs).toContainText('Round tax per line or per order?');
  await expect(needs).toContainText('no pull request yet · Sonnet 5');
  await expect(needs).toContainText('Started by this chat');
  await expect(needs.locator('.sub-status svg')).toHaveCount(1);
  const ready = group(page, 'Ready for review 1');
  await expect(ready).toContainText('spark/payments-api-v2');
  await expect(ready).toContainText('checks passing · Opus 5.5');
  await expect(ready.getByRole('link', { name: 'Pull request 412' })).toHaveAttribute(
    'href',
    'https://github.com/acme/shop/pull/412',
  );
  await expect(group(page, 'Working 1')).toContainText('stacked on Payments API v2');
  const held = group(page, 'Held 1');
  await expect(held).toContainText(
    'Starts after Payments API v2, Cart totals service, Checkout UI · Haiku 4.5',
  );
  await expect(panel(page)).toContainText(
    'Spark never merges. Each sub-chat publishes under its own mode and autonomy.',
  );
  await expect(panel(page).getByRole('tab', { name: 'Plan' })).toHaveCount(0);
  for (const [theme, skin] of Object.entries(SKINS)) {
    await page.evaluate((value) => {
      document.documentElement.dataset.skin = value;
    }, skin);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await expectAccessible(page, 'aside.wp');
    await expectAccessible(page, 'main');
    if (SHOT && theme === 'dark') await page.screenshot({ path: SHOT });
  }
});

test('a report shows as a block with fixed fields and the message lines sit under their turn', async ({
  page,
}) => {
  await openParent(page);
  const report = thread(page).getByRole('region', { name: 'Report from Payments API v2' });
  await expect(report.locator('.sub-status')).toHaveText('Ready for review');
  await expect(report.locator('dt')).toHaveText([
    'Changed',
    'Branch and pull request',
    'Risks',
    'Blockers',
  ]);
  await expect(report).toContainText('New payments/v2 client, 14 files');
  await expect(report).toContainText('spark/payments-api-v2 · committed · pushed · #412');
  await expect(report.locator('dd').last()).toHaveText('None stated');
  await expect(report).toContainText('not checked by Spark');
  await expect(report).toContainText('not your message');

  const asks = thread(page).locator('.sc-asks');
  await expect(asks).toContainText(
    'Asked Cart totals service: Is the tax table shared with invoices? · Replied',
  );
  await expect(asks).toContainText(
    'Reply from Cart totals service: Yes, invoices read the same table. · not your message',
  );
  const exchanges = asks.locator('details.sc-exchanges');
  await expect(exchanges.locator('> summary')).toHaveText('2 exchanges with Checkout UI');
  await expect(exchanges.getByText('Sent to Checkout UI: Keep the old form too.')).toBeHidden();
  await exchanges.locator('> summary').focus();
  await page.keyboard.press('Enter');
  await expect(exchanges.getByText('Sent to Checkout UI: Keep the old form too.')).toBeVisible();
});

test('a row opens its sub-chat by keyboard, which starts with the parent’s task card', async ({
  page,
}) => {
  await openTab(page);
  const tab = panel(page).getByRole('tab', { name: 'Sub-chats' });
  await tab.focus();
  await page.keyboard.press('Tab');
  await expect(
    panel(page).getByRole('button', { name: 'Cart totals service', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'Open Cart totals service' })).toBeFocused();
  await page.keyboard.press('Enter');
  const card = thread(page).getByRole('region', { name: `Task from ${PARENT}` });
  await expect(card).toContainText('Started by that chat · not your message');
  await expect(card).toContainText('Keep the public API of cart.ts unchanged.');
  await expect(card).toContainText('Started with Sonnet 5 · medium effort');
  await expect(card).toContainText('Full auto → PR');
  await expect(thread(page).locator('.msg.me')).toHaveCount(0);
  await expect(thread(page).locator('.sc-asks')).toContainText(
    `From ${PARENT}: Is the tax table shared with invoices? · not your message`,
  );
  await expect(panel(page).getByRole('tab', { name: 'Sub-chats' })).toHaveCount(0);
  await expectAccessible(page, 'main');
});

test('Start anyway starts a held sub-chat', async ({ page }) => {
  await openTab(page);
  const held = group(page, 'Held 1');
  const started = page.waitForResponse(
    (response) => response.url().endsWith('/start') && response.request().method() === 'POST',
  );
  await held.getByRole('button', { name: 'Start anyway: E2E checkout tests' }).click();
  expect((await started).status()).toBe(200);
  await expect(group(page, 'Held 1')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^Start anyway/ })).toHaveCount(0);
  await expect(panel(page).locator('.scp-row', { hasText: 'E2E checkout tests' })).toBeVisible();
});

test('a parent with no task of its own still lists its sub-chats', async ({ page }) => {
  await openParent(page);
  await startedLine(page).getByRole('button', { name: 'Open the Sub-chats tab' }).click();
  const listed = panel(page).getByRole('region', { name: 'Sub-chats', exact: true });
  await expect(listed.locator('.scp-group h3')).toHaveText([
    'Needs you · 1',
    'Ready for review · 1',
    'Working · 1',
    'Held · 1',
  ]);
  await expect(panel(page).getByRole('tab', { name: 'Sub-chats' })).toHaveCount(0);
});

test('a paired phone reads the Sub-chats tab', async ({ page }) => {
  await asPairedPhone(page);
  await page.setViewportSize(PHONE);
  await openChats(page);
  await page.getByRole('button', { name: /^(Show|Open) sidebar/ }).click();
  await rowButton(page, PARENT).click();
  await startedLine(page).getByRole('button', { name: 'Open the Sub-chats tab' }).click();
  await expect(panel(page).locator('.scp-group h3').first()).toHaveText('Needs you · 1');
  await expect(group(page, 'Held 1').getByRole('button', { name: /^Start anyway/ })).toBeVisible();
  await expect(group(page, 'Ready for review 1')).toContainText('spark/payments-api-v2');
  await expectNoSidewaysScroll(page);
});
