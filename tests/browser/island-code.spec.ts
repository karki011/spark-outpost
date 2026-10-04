import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { crewRepo, pickPermission, type CrewRepo } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import {
  fakeHomeDesktop,
  fakeState,
  island,
  nowCard,
  openHome,
  openIsland,
} from './island-home-desktop.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.ISLAND_CODE_SHOTS ?? '';

let repo: CrewRepo;

test.beforeEach(async () => {
  repo = crewRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => repo.remove());

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(SHOTS, `island-code-${name}.png`),
    clip: { x: 180, y: 0, width: 920, height: 460 },
  });
}

async function editsChat(page: Page, edits: number): Promise<void> {
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(repo.root)}`) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(`Rewrite the live table #livediff ${edits} 5ms`);
  await input.press('Enter');
  await expect(page.locator('.md', { hasText: `livediff=done ${edits}` })).toBeVisible({
    timeout: 20_000,
  });
}

async function islandPage(page: Page, theme = 'graphite'): Promise<Page> {
  const next = await page.context().newPage();
  await fakeHomeDesktop(next, theme);
  await openIsland(next);
  await openHome(next);
  return next;
}

const log = (page: Page) => nowCard(page).getByRole('list', { name: 'Latest steps' });

test('an edit step shows its line counts and opens a diff peek with the keyboard', async ({
  page,
}) => {
  await editsChat(page, 8);
  const view = await islandPage(page);

  await expect(log(view).getByRole('listitem')).toHaveText([
    'Done: Edited · module2.ts +2 −0',
    'Done: Edited · growing.ts +100 −0',
    'Done: Edited · module3.ts +2 −0',
  ]);
  await shot(view, 'rows');

  const row = log(view).getByRole('button', {
    name: 'Edited growing.ts, 100 added, 0 removed. Show the change',
  });
  await row.focus();
  await view.keyboard.press('Enter');
  const peek = nowCard(view).getByRole('group', { name: 'Change to growing.ts' });
  await expect(peek).toBeVisible();
  await expect(peek.getByRole('button', { name: 'Back to steps' })).toBeFocused();
  const diff = peek.getByRole('region', { name: 'Changes to growing.ts' });
  await expect(diff).toContainText("export const row0 = compute(0, 'row 0 written live');");
  await expect(diff.locator('.dv-row')).toHaveCount(80);
  await expect(diff).toContainText('20 more lines');
  await expect(peek).toContainText('src/live');
  await expect(nowCard(view).getByRole('list', { name: 'Latest steps' })).toHaveCount(0);
  const axe = await new AxeBuilder({ page: view }).include('.isl-now').analyze();
  expect(axe.violations).toEqual([]);
  await shot(view, 'peek');

  await view.keyboard.press('Tab');
  await expect(diff).toBeFocused();
  await view.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
  await expect(island(view).getByRole('tab', { name: 'Home' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(row).toBeFocused();

  await row.click();
  await peek.getByRole('button', { name: 'Back to steps' }).click();
  await expect(row).toBeFocused();

  await row.click();
  await expect(peek.getByRole('button', { name: /editor/i })).toHaveCount(0);
  await peek.getByRole('button', { name: 'Open chat' }).click();
  const opened = await fakeState(view);
  expect(opened.openedChats).toHaveLength(1);
  expect(opened.openedTurns[0]).toMatch(/^[0-9a-f-]{36}$/);
});
