import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';
import { openChats } from './navigation.ts';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-sidebar-projects-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const group = (page: Page, name: string) => sidebar(page).locator('.pblock', { hasText: name });
const toast = (page: Page, text: string) =>
  sidebar(page).getByRole('status').filter({ hasText: text });

async function createProject(page: Page, name: string) {
  const folder = path.join(mkdtempSync(path.join(base, 'p-')), name);
  mkdirSync(folder);
  const response = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(response.ok()).toBe(true);
  return { folder, ...((await response.json()) as { id: string; name: string }) };
}

async function openProjectMenu(page: Page, name: string) {
  await group(page, name).locator('.proj').hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for project ${name}` })
    .click();
  return page.getByRole('menu', { name: `Options for project ${name}` });
}

test('renames a project from its menu', async ({ page }) => {
  await openChats(page);
  await createProject(page, 'live-crew');
  await page.reload();
  const menu = await openProjectMenu(page, 'live-crew');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'New chat in project',
    'Rename',
    'Remove project',
  ]);
  await menu.getByRole('menuitem', { name: 'Rename' }).click();
  const input = sidebar(page).getByRole('textbox', { name: 'Project name' });
  await expect(input).toBeFocused();
  await input.fill('Crew demo');
  await input.press('Enter');
  await expect(group(page, 'Crew demo')).toBeVisible();
  await page.reload();
  await expect(group(page, 'Crew demo')).toBeVisible();
  await expect(sidebar(page).getByText('live-crew')).toHaveCount(0);
});

test('removes a project after one confirmation and undo brings its chats back', async ({
  page,
}) => {
  await openChats(page);
  const project = await createProject(page, 'live-crew');
  await seedChats([{ title: 'Crew chat', projectIds: [project.id] }, { title: 'Loose chat' }]);
  await page.reload();
  await expect(group(page, 'live-crew').getByRole('listitem')).toHaveText(['Crew chat']);

  let menu = await openProjectMenu(page, 'live-crew');
  await menu.getByRole('menuitem', { name: 'Remove project' }).click();
  const confirm = page.getByRole('menu', { name: 'Remove live-crew?' });
  await expect(confirm).toContainText(
    'Remove live-crew? Its chats move to Chats. Nothing on disk is deleted.',
  );
  await confirm.getByRole('menuitem', { name: 'Cancel' }).click();
  await expect(group(page, 'live-crew')).toBeVisible();

  menu = await openProjectMenu(page, 'live-crew');
  await menu.getByRole('menuitem', { name: 'Remove project' }).click();
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
  await expect(group(page, 'live-crew')).toHaveCount(0);
  const chats = sidebar(page).locator('.cblock');
  await expect(chats.getByRole('listitem')).toHaveText(['Crew chat', 'Loose chat']);
  expect(existsSync(project.folder)).toBe(true);

  await toast(page, 'Removed live-crew').getByRole('button', { name: 'Undo' }).click();
  await expect(group(page, 'live-crew').getByRole('listitem')).toHaveText(['Crew chat']);
  await expect(chats.getByRole('listitem')).toHaveText(['Loose chat']);
  await page.reload();
  await expect(group(page, 'live-crew').getByRole('listitem')).toHaveText(['Crew chat']);

  menu = await openProjectMenu(page, 'live-crew');
  await menu.getByRole('menuitem', { name: 'Remove project' }).click();
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).press('Enter');
  await expect(toast(page, 'Removed live-crew')).toBeHidden({ timeout: 8_000 });
  await page.reload();
  await expect(group(page, 'live-crew')).toHaveCount(0);
  await expect(chats.getByRole('listitem')).toHaveText(['Crew chat', 'Loose chat']);
  expect(existsSync(project.folder)).toBe(true);
});

test('the sidebar is wider, rows keep a gap, and the rail has a separator', async ({ page }) => {
  await seedChats([{ title: 'First chat' }, { title: 'Second chat' }, { title: 'Third chat' }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChats(page);
  expect((await sidebar(page).boundingBox())?.width).toBe(300);

  const rows = sidebar(page).locator('.cblock .row');
  await rows.nth(1).hover();
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  expect(second!.y - (first!.y + first!.height)).toBeGreaterThanOrEqual(2);

  const separator = await page
    .getByRole('navigation', { name: 'Main' })
    .evaluate((rail) => getComputedStyle(rail, '::after').content);
  expect(separator).toBe('none');

  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(sidebar(page)).toBeInViewport();
  expect(Math.round((await sidebar(page).boundingBox())!.width)).toBe(288);
});
