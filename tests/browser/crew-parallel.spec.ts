import { expect, test, type Page } from '@playwright/test';
import {
  CREW_REQUEST,
  agentHead,
  card,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });

test('parallel Builders show as one group with their own approvals', async ({ page }) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Balanced');
  await send(page, `${CREW_REQUEST} #build #crew #parallel`);
  const plan = card(page, /Approve the plan/);
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await plan.getByRole('button', { name: 'Approve' }).click();

  const first = card(page, /Change a file\?/).filter({ hasText: 'src/dates.ts' });
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.getByRole('button', { name: 'Allow', exact: true }).click();

  const group = page.getByRole('group', { name: /^Working in parallel: Rivet and Tack$/ });
  await expect(group).toBeVisible({ timeout: 30_000 });
  const heads = group.locator('.par-head');
  await expect(heads).toHaveCount(2);
  await expect(heads.nth(0)).toContainText('Rivet');
  await expect(heads.nth(0)).toContainText('Builder');
  await expect(heads.nth(1)).toContainText('Tack');

  const rivetEdit = group.getByRole('group', { name: /Change a file\?/ }).filter({
    hasText: 'src/divider.tsx',
  });
  const tackEdit = group.getByRole('group', { name: /Change a file\?/ }).filter({
    hasText: 'src/turns.ts',
  });
  await expect(rivetEdit).toBeVisible({ timeout: 30_000 });
  await expect(tackEdit).toBeVisible({ timeout: 30_000 });
  const waiting = panel(page).getByRole('list', { name: 'Waiting for you' });
  await expect(waiting).toContainText("Rivet's copy");
  await expect(waiting).toContainText("Tack's copy");
  await rivetEdit.getByRole('button', { name: 'Allow', exact: true }).click();
  await tackEdit.getByRole('button', { name: 'Allow', exact: true }).click();

  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('group', { name: /^Worked in parallel: Rivet and Tack$/ }),
  ).toBeVisible();
  const tasks = panel(page);
  const together = tasks.getByRole('list', { name: 'In parallel' });
  await expect(together.getByRole('listitem')).toHaveCount(2);
  await expect(together).toContainText('Rivet · Builder');
  await expect(together).toContainText('Tack · Builder');

  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.crew-foot')).toContainText('Done 5 agents', { timeout: 30_000 });
  const worked = page.getByRole('group', { name: /^Worked in parallel: Rivet and Tack$/ });
  await worked.locator('.par-head').nth(1).click();
  await expect(agentHead(page, 'Tack')).toBeVisible();
  expect(repo.file('src/turns.ts')).toBe('step 3\n');
  expect(repo.file('src/divider.tsx')).toBe('step 2\n');
});

test('a merge conflict card shows both changes and keeps the one you pick', async ({ page }) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Hands-off');
  await send(page, `${CREW_REQUEST} #build #crew #parallel #collide`);
  const conflict = card(page, /Parallel changes collided/);
  await expect(conflict).toBeVisible({ timeout: 60_000 });
  await expect(conflict).toContainText('Rivet and Tack both changed notes.txt.');
  const sides = conflict.getByRole('list', { name: 'Conflicting changes' });
  await expect(sides).toContainText('Rivet’s change');
  await expect(sides).toContainText('Tack’s change');
  await expect(sides.locator('.dv-row.add')).toHaveCount(2);
  await expect(conflict.getByRole('button', { name: 'Ask a Builder to reconcile' })).toBeVisible();
  await conflict.getByRole('button', { name: 'Keep Tack’s' }).click();
  await expect(conflict).toContainText('Kept Tack’s change.');
  await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\nstep 3\n');
});
