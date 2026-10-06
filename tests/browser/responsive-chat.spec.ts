import { expect, test, type Page } from '@playwright/test';
import { crewRepo, type CrewRepo } from './crew-engine.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { editedChat } from './edited-chat.ts';
import {
  DESKTOP,
  expectInsideViewport,
  expectNoSidewaysScroll,
  openTouch,
  PHONE,
  PHONE_WIDE,
  shot,
  sizeName,
  smallTapTargets,
  smallTextInputs,
  TABLET,
  TABLET_WIDE,
} from './responsive-kit.ts';

test.describe.configure({ timeout: 180_000 });
test.use({ trace: 'off' });

const WIDE_TABLE = [
  'Here is what changed, with the numbers per package.',
  '| Package | Before | After | Change | Owner | Notes |\n| --- | --- | --- | --- | --- | --- |\n| apps/web/src/chat/composer | 1,204 ms | 811 ms | −33% | Maya | Split the queue reducer out of the composer |\n| packages/contracts | 310 ms | 305 ms | −2% | Pip | No real change |',
].join('\n\n');

const changesChip = (page: Page) =>
  page.getByRole('button', { name: /added, \d+ removed in \d+ files?$/ });
const workPanel = (page: Page) => page.locator('#work-panel');

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  repo = crewRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await page.setViewportSize(DESKTOP);
  await editedChat(page, repo.root);
});

test.afterEach(() => repo.remove());

async function replyWithTable(): Promise<void> {
  const db = openTestDb();
  try {
    await db.query(`UPDATE messages SET content = $1 WHERE role = 'assistant'`, [WIDE_TABLE]);
  } finally {
    await db.end();
  }
}

for (const size of [PHONE, PHONE_WIDE]) {
  test(`the chat top bar fits with the changes chip at ${sizeName(size)}`, async ({ browser }) => {
    const page = await openTouch(browser, size, 'chats');
    await expect(changesChip(page)).toBeVisible({ timeout: 20_000 });
    const head = page.locator('.chat-head');
    await expect(head.locator('.crumb')).toBeHidden();
    await expect(head.getByRole('button', { name: 'Theme' })).toHaveCount(0);
    for (const control of await head.locator('.head-r > *:visible').all()) {
      await expectInsideViewport(page, control);
    }
    await expectInsideViewport(page, head.getByRole('button', { name: 'Chat actions' }));
    expect(await head.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
      0,
    );
    const title = await head.locator('.chat-title').boundingBox();
    expect(title!.width).toBeGreaterThan(60);
    expect(await smallTapTargets(page)).toEqual([]);
    expect(await smallTextInputs(page)).toEqual([]);
    await expectNoSidewaysScroll(page);
    await shot(page, 'chat-with-changes');
    await page.close();
  });
}

test('a wide table scrolls inside its own box on a phone', async ({ browser }) => {
  await replyWithTable();
  const page = await openTouch(browser, PHONE, 'chats');
  const table = page.locator('.md-table').last();
  await expect(table).toBeVisible({ timeout: 20_000 });
  await table.scrollIntoViewIfNeeded();
  const box = await table.evaluate((node) => ({
    scrolls: node.scrollWidth > node.clientWidth,
    right: node.getBoundingClientRect().right,
    narrowest: Math.min(
      ...[...node.querySelectorAll('th')].map((cell) => cell.getBoundingClientRect().width),
    ),
    tallestCell: Math.max(
      ...[...node.querySelectorAll('td')].map((cell) => cell.getBoundingClientRect().height),
    ),
  }));
  expect(box.scrolls).toBe(true);
  expect(box.right).toBeLessThanOrEqual(PHONE.width);
  expect(box.narrowest).toBeGreaterThan(50);
  expect(box.tallestCell).toBeLessThan(200);
  await expectNoSidewaysScroll(page);
  await shot(page, 'chat-table');
  await page.close();
});

test('the changes drawer is unified on a phone and keeps the desktop choice', async ({
  browser,
}) => {
  const page = await openTouch(browser, PHONE, 'chats', (opened) =>
    opened.addInitScript(() => localStorage.setItem('spark-outpost.diff-drawer.mode', 'split')),
  );
  await changesChip(page).click();
  const drawer = page.locator('.dd');
  await expect(drawer).toBeVisible();
  const file = drawer.getByRole('treeitem', { name: /notes\.txt/ });
  if (!(await file.isVisible())) await drawer.getByRole('treeitem').first().click();
  await file.click();
  await expect(drawer.locator('.cm-editor').first()).toBeVisible({ timeout: 20_000 });
  await expect(drawer.locator('.cm-editor')).toHaveCount(1);
  await expect(drawer.getByRole('radiogroup', { name: 'Diff layout' })).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('spark-outpost.diff-drawer.mode'));
  expect(saved).toBe('split');
  await shot(page, 'diff-drawer');
  await page.close();
});

test('the Work panel docks only when the chat keeps room', async ({ browser, page }) => {
  const docked = async (target: Page) => {
    const show = target.getByRole('button', { name: 'Show work panel' });
    if (await show.isVisible()) await show.click();
    await expect(workPanel(target)).toBeVisible();
    return workPanel(target).evaluate((node) => !node.classList.contains('over'));
  };

  await page.goto('/');
  await expect(changesChip(page)).toBeVisible({ timeout: 20_000 });
  expect(await docked(page)).toBe(true);
  const roomy = await page.locator('main.main').boundingBox();
  expect(roomy!.width).toBeGreaterThan(460);
  await shot(page, 'work-panel');

  await page.setViewportSize(TABLET_WIDE);
  await expect(workPanel(page)).toBeHidden();
  expect(await docked(page)).toBe(false);
  const beside = await page.locator('main.main').boundingBox();
  expect(beside!.width).toBeGreaterThan(700);
  await shot(page, 'work-panel');
  await workPanel(page).getByRole('button', { name: 'Hide work panel' }).click();
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  expect(await docked(page)).toBe(true);
  const collapsed = await page.locator('main.main').boundingBox();
  expect(collapsed!.width).toBeGreaterThan(460);

  const tablet = await openTouch(browser, TABLET, 'chats');
  await expect(changesChip(tablet)).toBeVisible({ timeout: 20_000 });
  expect(await docked(tablet)).toBe(false);
  expect(await smallTapTargets(tablet)).toEqual([]);
  await shot(tablet, 'work-panel');
  await tablet.close();
});
