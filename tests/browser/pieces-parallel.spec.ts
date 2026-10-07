import { expect, test, type Locator, type Page } from '@playwright/test';
import { PIECE_CHECK_SCRIPT } from '../../apps/server/test/fake-acp-coordinator.ts';
import { card, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';

const REQUEST = 'Split this up: build a store, add an API and add a view. #build #pieces #parallel';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  repo.commit('piece-check.mjs', PIECE_CHECK_SCRIPT);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

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

const board = (page: Page) => page.getByRole('region', { name: 'Pieces' });
const pieceRow = (page: Page, key: string) =>
  board(page)
    .getByRole('listitem')
    .filter({ has: page.locator('.piece-key', { hasText: new RegExp(`^${key}$`) }) });
const tvOf = (page: Page) => page.getByRole('dialog', { name: 'Agent TV' });
const spoke = (page: Page, key: string) => tvOf(page).locator(`.tv-n[data-piece="${key}"]`);

async function openTv(page: Page, view: 'Stage' | 'List'): Promise<Locator> {
  const direct = page.getByRole('button', { name: 'Agent TV' });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole('button', { name: 'Chat actions' }).click();
    await page.getByRole('menuitem', { name: 'Agent TV' }).click();
  }
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
  await expect(board(page).locator('.piece-board-why')).toContainText(
    /^Jev: 3 pieces · P1 [^·]+, shared tree · P2 [^·]+, shared tree · P3 [^·]+, shared tree; /,
  );
  await expect(card(page, /Build this plan\?/)).toHaveCount(0);

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
    /^Rivet, P2 API, shared tree, landed, Jev: reasoning 2, coding 2, context 2 → demand low → mid route → Claude Sonnet 5 \(the chat's provider\)\. Show details$/,
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
