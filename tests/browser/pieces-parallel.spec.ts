import { expect, test, type Locator, type Page } from '@playwright/test';
import { PIECE_CHECK_SCRIPT } from '../../apps/server/test/fake-acp-coordinator.ts';
import {
  autoContinueAfter,
  card,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const REQUEST = 'Split this up: build a store, add an API and add a view. #build #pieces #parallel';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  repo.commit('piece-check.mjs', PIECE_CHECK_SCRIPT);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

async function buildThePlan(page: Page): Promise<void> {
  const plan = card(page, /Build this plan\?/);
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await plan.getByRole('button', { name: 'Build this plan' }).click();
}

async function allowChecksWhile(page: Page, settled: () => Promise<void>): Promise<void> {
  await expect(async () => {
    const pending = card(page, /^Run a check\?/).filter({
      has: page.getByRole('button', { name: 'Deny' }),
    });
    if ((await pending.count()) > 0) {
      await pending.first().getByRole('button', { name: 'Allow', exact: true }).click();
    }
    await settled();
  }).toPass({ timeout: 120_000 });
}

function allowChecksUntil(page: Page, done: Locator, text: string): Promise<void> {
  return allowChecksWhile(page, () => expect(done).toContainText(text, { timeout: 1_000 }));
}

function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const board = (page: Page) => page.getByRole('region', { name: 'Pieces' });
const pieceRow = (page: Page, key: string) =>
  board(page)
    .getByRole('listitem')
    .filter({ has: page.locator('.piece-key', { hasText: new RegExp(`^${key}$`) }) });
const tvOf = (page: Page) => page.getByRole('dialog', { name: 'Agent TV' });
const spoke = (page: Page, key: string) => tvOf(page).locator(`.tv-n[data-piece="${key}"]`);

async function focusByShiftTab(page: Page, target: Locator): Promise<void> {
  await page.getByRole('textbox', { name: 'Message' }).focus();
  await expect(async () => {
    await page.keyboard.press('Shift+Tab');
    await expect(target).toBeFocused({ timeout: 100 });
  }).toPass({ timeout: 20_000 });
}

async function showsFocusRing(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    const ring = style.outlineStyle !== 'none' || style.boxShadow !== 'none';
    return element.matches(':focus-visible') && ring;
  });
}

async function openTv(page: Page, view: 'Stage' | 'List'): Promise<Locator> {
  await page.getByRole('button', { name: 'Agent TV' }).click();
  const tv = tvOf(page);
  await tv.getByRole('radio', { name: view }).click();
  return tv;
}
const parallelGroup = (page: Page) =>
  page.getByRole('group', { name: /^Work(ing|ed) in parallel: / });

test('Automatic builds independent pieces side by side in the shared tree', async ({ page }) => {
  test.setTimeout(150_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, REQUEST);
  await buildThePlan(page);

  await allowChecksUntil(page, board(page), '3 pieces, in the shared tree · 3 landed');
  await expect(board(page).getByRole('button')).toHaveCount(0);
  const group = parallelGroup(page);
  await expect(group).toBeVisible();
  const heads = group.locator('.par-head');
  await expect(heads).toHaveCount(3);
  await expect(heads.filter({ hasText: 'Rivet' })).toContainText('P2 · shared tree · owns 3 files');
  const bolt = heads.filter({ hasText: 'Bolt' });
  await expect(bolt).toHaveAttribute('aria-expanded', 'false');
  await bolt.focus();
  await page.keyboard.press('Enter');
  await expect(bolt).toHaveAttribute('aria-expanded', 'true');
  await expect(group.locator('.par-body .agent-block')).toHaveCount(1);
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });

  const titles: [string, string][] = [
    ['P1', 'Store'],
    ['P2', 'API'],
    ['P3', 'View'],
  ];
  for (const [key, title] of titles) {
    await expect(pieceRow(page, key).locator('.piece-title')).toHaveText(title);
    await expect(pieceRow(page, key).locator('.piece-state')).toHaveText('landed');
    await expect(pieceRow(page, key)).toContainText('shared tree');
    await expect(pieceRow(page, key)).toContainText('scoped check passed');
  }

  const work = page.getByRole('complementary', { name: 'Work panel' });
  const tasksTab = work.getByRole('tab', { name: 'Tasks' });
  await tasksTab.click();
  await page.keyboard.press('End');
  await expect(work.getByRole('tab', { name: 'Cost' })).toBeFocused();
  await expect(work.getByRole('tab', { name: 'Cost' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tasksTab).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(work.getByRole('tab', { name: 'Cost' })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const crewTab = work.getByRole('tab', { name: 'Crew' });
  await expect(crewTab).toBeFocused();
  await expect(crewTab).toHaveAttribute('aria-selected', 'true');
  const crewList = work.getByRole('list', { name: 'Crew' });
  await expect(crewList.getByRole('listitem').filter({ hasText: 'Rivet' })).toContainText(
    'P2 · shared tree · owns 3 files',
  );

  const tv = await openTv(page, 'Stage');
  const hub = tv.locator('.tv-n.jev');
  await expect(hub).toContainText('Coordinator');
  await expect(tv.locator('.tv-n[data-piece]')).toHaveCount(3);
  await expect(spoke(page, 'P2')).toHaveAttribute(
    'aria-label',
    /^Rivet, P2 API, shared tree, landed\. Show details$/,
  );
  await expect(spoke(page, 'P1')).toContainText('P1 · Store');
  await expect(spoke(page, 'P1').locator('.piece-state')).toHaveText('landed');
  await expect(spoke(page, 'P1')).toContainText('shared tree');
  await tv.getByRole('radio', { name: 'List' }).click();
  await tv.getByRole('button', { name: /^Finished/ }).click();
  const boltRow = tv.getByRole('listitem', { name: /^Bolt/ });
  await expect(boltRow).toContainText('P1 · Store · shared tree · owns 1 file');
  await expect(boltRow.locator('.piece-state')).toHaveText('landed');
  expect(repo.file('api.ts')).toContain('built by P2');
});

test('Review each step asks for the split before building it, answered by keyboard', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await crewChat(page, repo, 'Review keep');
  await send(page, REQUEST);

  await buildThePlan(page);

  const split = card(page, /Build in 3 pieces, 2 at once in the shared tree\?/);
  await expect(split).toBeVisible({ timeout: 60_000 });
  await expect(board(page)).toContainText('waiting for your go-ahead');
  await expect(pieceRow(page, 'P3')).toContainText('waiting on P1');
  const build = split.getByRole('button', { name: 'Build it' });
  const inOrder = split.getByRole('button', { name: 'Build in order instead' });
  const revise = split.getByRole('button', { name: 'Revise' });
  await focusByShiftTab(page, build);
  expect(await showsFocusRing(build)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(inOrder).toBeFocused();
  expect(await showsFocusRing(inOrder)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(revise).toBeFocused();
  expect(await showsFocusRing(revise)).toBe(true);
  await page.keyboard.press('Space');
  const note = split.getByRole('textbox', { name: 'What should change in the split?' });
  await expect(note).toBeFocused();
  await page.keyboard.type('Keep the view last');
  await page.keyboard.press('Tab');
  await expect(split.getByRole('button', { name: 'Revise the plan' })).toBeFocused();
  await page.keyboard.press('Enter');

  const splits = card(page, /Build in 3 pieces, 2 at once in the shared tree\?/);
  await expect(splits).toHaveCount(2, { timeout: 60_000 });
  const again = splits.last();
  const buildAgain = again.getByRole('button', { name: 'Build it' });
  await focusByShiftTab(page, buildAgain);
  await page.keyboard.press('Enter');
  await expect(again.getByRole('status')).toBeVisible();

  await allowChecksUntil(page, board(page), '3 pieces, in the shared tree · 3 landed');
  await expect(parallelGroup(page)).toBeVisible();
});

test('Full auto builds each piece in its own copy of the chat worktree', async ({ page }) => {
  test.setTimeout(150_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Full auto');
  await send(page, `${REQUEST} #manifest`);

  await expect(board(page)).toContainText('3 pieces, in worktrees · 3 landed', {
    timeout: 90_000,
  });
  const group = parallelGroup(page);
  await expect(group.locator('.par-head').filter({ hasText: 'Tack' })).toContainText(
    "P3 · Tack's copy",
  );
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 60_000 });
  expect(repo.file('view.ts')).toContain('built by P3');

  await page.setViewportSize({ width: 375, height: 812 });
  await board(page).scrollIntoViewIfNeeded();
  await expect(board(page)).toBeInViewport();
  expect(await horizontalOverflow(page)).toBe(0);
  const boardBox = (await board(page).boundingBox())!;
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(375);
  await expect(pieceRow(page, 'P3')).toContainText("Tack's copy");

  const tv = await openTv(page, 'Stage');
  const hub = tv.locator('.tv-n.jev');
  await expect(hub).toContainText('Coordinator');
  const tvBox = (await tv.boundingBox())!;
  expect(tvBox.x).toBeGreaterThanOrEqual(0);
  expect(tvBox.x + tvBox.width).toBeLessThanOrEqual(375);
  expect(tvBox.y + tvBox.height).toBeLessThanOrEqual(812);
  for (const key of ['P1', 'P2', 'P3']) {
    const box = (await spoke(page, key).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(tvBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(tvBox.x + tvBox.width);
    expect(box.y + box.height).toBeLessThanOrEqual(tvBox.y + tvBox.height);
  }
  await expect(spoke(page, 'P3')).toContainText("Tack's copy");
  expect(await horizontalOverflow(page)).toBe(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(spoke(page, 'P3').locator('.piece-state')).toHaveText('landed');
  await expect(spoke(page, 'P3')).toBeVisible();
});

test('two copies that collide go to the integrator, then to the merge conflict card', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await crewChat(page, repo, 'Review keep');
  await send(page, `${REQUEST} #manifest #useredit #unresolvable`);
  await buildThePlan(page);

  const split = card(page, /^Build in 3 pieces/).filter({
    has: page.getByRole('button', { name: 'Build it' }),
  });
  await expect(split).toBeVisible({ timeout: 60_000 });
  await expect(board(page)).toContainText('in worktrees');
  await split.getByRole('button', { name: 'Build it' }).click();

  const conflict = card(page, /copy and your files collided/);
  await allowChecksWhile(page, () => expect(conflict).toBeVisible({ timeout: 1_000 }));
  await expect(conflict).toContainText("Bolt's copy and your working tree both changed store.ts.");
  await expect(conflict.getByRole('list', { name: 'Conflicting changes' })).toContainText(
    'store.ts',
  );
  const keepBolt = conflict.getByRole('button', { name: /^Keep Bolt/ });
  await expect(conflict.getByRole('button', { name: 'Stop' })).toBeVisible();
  await keepBolt.click();
  await expect(keepBolt).toBeHidden({ timeout: 15_000 });

  await allowChecksUntil(page, board(page), '3 pieces, in worktrees · 3 landed');
  await expect(pieceRow(page, 'P1')).toContainText("Bolt's copy");
  expect(repo.file('store.ts')).toContain('built by P1');
});
