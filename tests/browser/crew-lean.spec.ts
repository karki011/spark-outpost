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
  const lean = styles.getByRole('radio', { name: 'Lean' });
  await expect(lean).toHaveAttribute('aria-checked', 'true');
  await expect(menu).toContainText('The default.');
  const off = styles.getByRole('radio', { name: 'Off' });
  await off.focus();
  await page.keyboard.press('Enter');
  await expect(off).toHaveAttribute('aria-checked', 'true');
  expect(await savedStyle(page)).toBe('off');
  await lean.focus();
  await page.keyboard.press('Enter');
  await expect(lean).toHaveAttribute('aria-checked', 'true');
  await expect(menu).toContainText('Validation, security and accessibility are never trimmed.');
  await page.keyboard.press('Escape');
  expect(await savedStyle(page)).toBe('lean');
}

async function savedStyle(page: Page): Promise<string | undefined> {
  const listed = await page.request.get('/api/projects');
  const projects = (await listed.json()) as { rootPath: string; buildStyle?: string }[];
  return projects.find((project) => project.rootPath === repo.root)?.buildStyle;
}

test('the lean build style is set per project and its shortcuts show in the work panel', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Full auto');
  await chooseLean(page);
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
