import { expect, test } from '@playwright/test';
import {
  CREW_REQUEST,
  agentBlock,
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

test('builds lean with no setting, and its shortcuts show in the work panel', async ({ page }) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Full auto');
  await send(page, `${CREW_REQUEST} #build #crew #leanmark`);

  const turn = page.locator('.crew-turn');
  await expect(turn.locator('.crew-foot')).toContainText('Done', { timeout: 60_000 });
  await expect(agentBlock(page, 'Hawk').first()).toContainText('net: -2 lines possible');
  expect(repo.notes()).toContain('// lean: fixed list; upgrade: load from config when asked');

  const work = page.getByRole('complementary', { name: 'Work panel' });
  await work.getByRole('tab', { name: 'Tasks' }).click();
  const done = work.getByRole('list', { name: 'Done' });
  const shortcut = done.getByRole('button', { name: /Deferred shortcuts?: \d+ marked lean:/ });
  await shortcut.click();
  await expect(work.getByLabel('Deferred shortcuts')).toContainText(
    'fixed list. upgrade: load from config when asked.',
  );
});
