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

const FAILS_UNTIL_FIXED = `import { existsSync, readFileSync } from 'node:fs';
if (readFileSync('notes.txt', 'utf8').includes('step') && !existsSync('fixed.txt')) {
  console.error('expected fixed.txt to exist');
  process.exit(1);
}
console.log('all good');
`;

const OLD_TYPE_ERROR = `console.log('src/old.ts(3,1): error TS2322: an old problem');
process.exit(1);
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
  repo.commit('check.mjs', FAILS_UNTIL_FIXED);
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
    .getByRole('button', { name: /Checks for Bolt.*check\.mjs failed/ });
  await failed.click();
  const output = work.getByLabel('Check output');
  await expect(output).toContainText('expected fixed.txt to exist');
  await expect(output).toContainText('passes before this change');
  await expect(work.getByRole('list', { name: 'Done' })).toContainText(
    /Checks for Bolt(?:'s copy)?: .*check\.mjs passed/,
  );
});

test('a check that already failed before the change is one calm row, with no fix turn', async ({
  page,
}) => {
  test.setTimeout(120_000);
  repo.commit('lint.mjs', "console.log('clean');\n");
  repo.commit('typecheck.mjs', OLD_TYPE_ERROR);
  await crewChat(page, repo, 'Full auto');
  await useChecks(page, [`${process.execPath} lint.mjs`, `${process.execPath} typecheck.mjs`]);
  await send(page, `${CREW_REQUEST} #build #crew`);

  const turn = page.locator('.crew-turn');
  await expect(turn.locator('.crew-foot')).toContainText('Done', { timeout: 60_000 });
  expect(() => repo.file('fixed.txt')).toThrow();

  const work = panel(page);
  await work.getByRole('tab', { name: 'Tasks' }).click();
  await expect(work.getByRole('list', { name: 'Remaining' })).toHaveCount(0);
  const row = work
    .getByRole('list', { name: 'Done' })
    .getByRole('button', { name: /Checks for Bolt/ });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(
    /Checks for Bolt(?:'s copy)?: lint passed · typecheck already failing before this change/,
  );
  await expect(row.locator('xpath=..')).not.toHaveClass(/failed/);
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const output = work.getByLabel('Check output');
  await expect(output).toContainText('also fails before this change');
  await expect(output).toContainText('same failures: type src/old.ts TS2322');
});

test('Accept edits: the check approval shows in the thread, Review jumps to it, and the fix turn runs the check again', async ({
  page,
}) => {
  test.setTimeout(120_000);
  repo.commit('check.mjs', FAILS_UNTIL_FIXED);
  await crewChat(page, repo, 'Auto-edit');
  const command = `${process.execPath} check.mjs`;
  await useChecks(page, [command]);
  await send(page, `${CREW_REQUEST} #build #crew`);

  const check = card(page, /^Run a check\?/).filter({
    has: page.getByRole('button', { name: 'Deny' }),
  });
  await expect(check).toBeVisible({ timeout: 30_000 });
  await expect(check).toContainText(command);
  await expect(agentHead(page, 'Jev')).toContainText('waiting for you');
  await expect(agentHead(page, 'Jev')).not.toContainText('hit a problem');

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
  await expect(keep).toContainText('Kept automatically.', { timeout: 60_000 });
  expect(repo.file('fixed.txt')).toBe('fixed\n');
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });
});
