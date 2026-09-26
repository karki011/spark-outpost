import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  CREW_REQUEST,
  agentBlock,
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
    /Checks passed for Bolt: .*check\.mjs passed/,
  );
});
