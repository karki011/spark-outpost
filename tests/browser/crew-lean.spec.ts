import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
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

async function chooseLean(page: Page): Promise<void> {
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  const styles = menu.getByRole('radiogroup', {
    name: `Build style for ${path.basename(repo.root)}`,
  });
  await expect(styles.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  const lean = styles.getByRole('radio', { name: 'Lean' });
  await lean.focus();
  await page.keyboard.press('Enter');
  await expect(lean).toHaveAttribute('aria-checked', 'true');
  await expect(menu).toContainText('Validation, security and accessibility are never trimmed.');
  await page.keyboard.press('Escape');
  const listed = await page.request.get('/api/projects');
  const saved = ((await listed.json()) as { rootPath: string; buildStyle: string }[]).find(
    (project) => project.rootPath === repo.root,
  );
  expect(saved?.buildStyle).toBe('lean');
}

test('the lean build style is set per project and its shortcuts show in the work panel', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Full auto');
  await chooseLean(page);
  await send(page, `${CREW_REQUEST} #build #crew`);

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
