import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  CREW_REQUEST,
  agentBlock,
  agentHead,
  card,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const FAILS_UNTIL_FIXED = `import { existsSync } from 'node:fs';
if (!existsSync('fixed.txt')) {
  console.error('expected fixed.txt to exist');
  process.exit(1);
}
console.log('all good');
`;

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });

async function useChecks(page: Page, commands: string[]): Promise<void> {
  const listed = await page.request.get('/api/projects');
  const project = ((await listed.json()) as { id: string; rootPath: string }[]).find(
    (candidate) => candidate.rootPath === repo.root,
  );
  expect(project).toBeDefined();
  const saved = await page.request.patch(`/api/projects/${project!.id}`, {
    data: { checkCommands: commands },
  });
  expect(saved.ok()).toBe(true);
}

test('a failing check goes back to the Builder, and the work panel shows both rounds', async ({
  page,
}) => {
  test.setTimeout(120_000);
  writeFileSync(path.join(repo.root, 'check.mjs'), FAILS_UNTIL_FIXED);
  await crewChat(page, repo, 'Full auto');
  const command = `${process.execPath} check.mjs`;
  await useChecks(page, [command]);
  await send(page, `${CREW_REQUEST} #build #crew`);

  const turn = page.locator('.crew-turn');
  await expect(turn.locator('.crew-foot')).toContainText('Done', { timeout: 60_000 });
  expect(repo.file('fixed.txt')).toBe('fixed\n');
  await expect(agentBlock(page, 'Hawk').first()).toContainText('Verdict: looks good');

  const work = panel(page);
  await work.getByRole('tab', { name: 'Tasks' }).click();
  const failed = work
    .getByRole('list', { name: 'Remaining' })
    .getByRole('button', { name: /Checks failed for Bolt/ });
  await expect(failed).toContainText('check.mjs exited 1');
  await failed.click();
  await expect(work.getByLabel('Check output')).toContainText('expected fixed.txt to exist');
  await expect(work.getByRole('list', { name: 'Done' })).toContainText(
    /Checks passed for Bolt(?:'s copy)?: .*check\.mjs passed/,
  );
});

test('Accept edits, review each step: the check approval shows in the thread, Review jumps to it, and the fix turn runs the check again', async ({
  page,
}) => {
  test.setTimeout(120_000);
  writeFileSync(path.join(repo.root, 'check.mjs'), FAILS_UNTIL_FIXED);
  await crewChat(page, repo, 'Review keep');
  const command = `${process.execPath} check.mjs`;
  await useChecks(page, [command]);
  await send(page, `${CREW_REQUEST} #build #crew`);

  const check = card(page, /^Run a check\?/).filter({
    has: page.getByRole('button', { name: 'Deny' }),
  });
  await expect(check).toBeVisible({ timeout: 30_000 });
  await expect(check).toContainText(command);
  await expect(agentHead(page, 'Jev')).toContainText('Waiting for you');
  await expect(agentHead(page, 'Jev')).not.toContainText('Failed');

  const waiting = panel(page).getByRole('list', { name: 'Waiting for you' });
  await expect(waiting).toContainText('Run check');
  await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
  await waiting.getByRole('button', { name: 'Review' }).click();
  await expect(check).toBeInViewport();
  await expect(check).toHaveClass(/flash/);
  await check.getByRole('button', { name: 'Allow', exact: true }).click();

  const again = card(page, /^Run a check\?/).filter({
    has: page.getByRole('button', { name: 'Deny' }),
  });
  await again.getByRole('button', { name: 'Allow', exact: true }).click({ timeout: 60_000 });
  const keep = page.getByRole('group', { name: 'Keep these changes?', exact: true });
  await expect(keep).toBeVisible({ timeout: 60_000 });
  expect(repo.file('fixed.txt')).toBe('fixed\n');
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });
});
