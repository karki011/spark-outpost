import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-drag-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const row = (page: Page, title: string) =>
  sidebar(page).getByRole('listitem').filter({ hasText: title });
const block = (page: Page, name: string) =>
  sidebar(page)
    .locator('.pblock')
    .filter({ has: page.locator('.proj-head .nm', { hasText: name }) });
const titles = (scope: Locator) => scope.locator('.row .tt');
const projectNames = (page: Page) => sidebar(page).locator('.proj-head .nm');
const announcer = (page: Page) => page.locator('[id^="DndLiveRegion"]');

function shownTitles(scope: Locator): Promise<string[]> {
  return scope.locator('.row').evaluateAll((rows) =>
    rows
      .map((node) => ({ y: node.getBoundingClientRect().y, text: node.textContent ?? '' }))
      .sort((a, b) => a.y - b.y)
      .map((entry) => entry.text.trim()),
  );
}

async function createProject(page: Page, name: string): Promise<{ id: string; name: string }> {
  const folder = path.join(base, String(Date.now()), name);
  mkdirSync(folder, { recursive: true });
  const response = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; name: string };
}

async function pickUp(page: Page, source: Locator) {
  const from = await source.boundingBox();
  if (!from) throw new Error('Drag source is not visible.');
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 48, from.y + from.height / 2 + 8, { steps: 4 });
}

async function hoverOver(page: Page, target: Locator, edge: 'top' | 'bottom') {
  const to = await target.boundingBox();
  if (!to) throw new Error('Drop target is not visible.');
  const y = edge === 'top' ? to.y + 5 : to.y + to.height - 5;
  await page.mouse.move(to.x + 40, y, { steps: 12 });
}

test('drags a chat into a project at the placeholder with a lifted card', async ({ page }) => {
  await page.goto('/');
  const project = await createProject(page, 'web');
  await seedChats([
    { title: 'Alpha', projectIds: [project.id], minutesAgo: 3 },
    { title: 'Beta', projectIds: [project.id], minutesAgo: 4 },
    { title: 'Loose idea', minutesAgo: 1 },
  ]);
  await page.reload();
  const group = block(page, project.name);
  await expect(titles(group)).toHaveText(['Alpha', 'Beta']);

  await pickUp(page, row(page, 'Loose idea'));
  await hoverOver(page, row(page, 'Beta'), 'top');
  await expect.poll(() => shownTitles(group)).toEqual(['Alpha', 'Loose idea', 'Beta']);
  await expect(group.locator('.row.placeholder')).toContainText('Loose idea');
  await expect(group).toHaveClass(/over/);
  const card = page.locator('.drag-card');
  await expect(card).toContainText('Loose idea');
  await expect(card.locator('svg')).toBeVisible();
  await page.mouse.up();

  await expect(page.locator('.drag-card')).toHaveCount(0);
  await expect(sidebar(page).getByRole('status').filter({ hasText: 'Moved to web' })).toBeVisible();
  await expect(group.locator('.row.placeholder')).toHaveCount(0);
  await page.reload();
  await expect(titles(block(page, project.name))).toHaveText(['Alpha', 'Loose idea', 'Beta']);
});

test('reorders chats inside a project and reorders the projects', async ({ page }) => {
  await page.goto('/');
  const alpha = await createProject(page, 'alpha');
  const beta = await createProject(page, 'beta');
  await seedChats([
    { title: 'First', projectIds: [alpha.id], minutesAgo: 1 },
    { title: 'Second', projectIds: [alpha.id], minutesAgo: 2 },
    { title: 'Third', projectIds: [alpha.id], minutesAgo: 3 },
  ]);
  await page.reload();
  await expect(projectNames(page)).toHaveText(['alpha', 'beta']);
  const group = block(page, 'alpha');
  await expect(titles(group)).toHaveText(['First', 'Second', 'Third']);

  await pickUp(page, row(page, 'Third'));
  await hoverOver(page, row(page, 'First'), 'top');
  await page.mouse.up();
  await expect(titles(group)).toHaveText(['Third', 'First', 'Second']);

  await pickUp(page, block(page, 'beta').locator('.proj-head'));
  await hoverOver(page, block(page, 'alpha').locator('.proj-head'), 'top');
  await expect(block(page, 'beta')).toHaveClass(/placeholder/);
  await expect(page.locator('.drag-card.project')).toContainText('beta');
  await page.mouse.up();
  await expect(projectNames(page)).toHaveText(['beta', 'alpha']);

  await page.reload();
  await expect(projectNames(page)).toHaveText(['beta', 'alpha']);
  await expect(titles(block(page, 'alpha'))).toHaveText(['Third', 'First', 'Second']);
  expect(beta.name).toBe('beta');
});

test('moves chats and projects with the keyboard and announces each step', async ({ page }) => {
  await page.goto('/');
  const web = await createProject(page, 'web');
  await createProject(page, 'zeta');
  await seedChats([
    { title: 'Web chat', projectIds: [web.id], minutesAgo: 2 },
    { title: 'Loose idea', minutesAgo: 1 },
  ]);
  await page.reload();

  const grip = sidebar(page).getByRole('button', { name: 'Move Loose idea' });
  await grip.focus();
  await expect(grip).toHaveAttribute('aria-roledescription', 'sortable');
  await page.keyboard.press('Space');
  await expect(announcer(page)).toContainText('Picked up Loose idea. It is in Chats.');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(announcer(page)).toContainText('Loose idea will move to zeta, position 1 of 1.');
  await page.keyboard.press('ArrowUp');
  await expect(announcer(page)).toContainText('Loose idea will move to web, position');
  await page.keyboard.press('Space');
  await expect(announcer(page)).toContainText('Dropped Loose idea in web, position');
  await expect(titles(block(page, 'web'))).toContainText(['Loose idea']);
  await expect(grip).toBeFocused();

  await grip.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(announcer(page)).toContainText('Cancelled. Loose idea stayed in web');
  await expect(titles(block(page, 'web'))).toContainText(['Loose idea']);

  const projectGrip = sidebar(page).getByRole('button', { name: 'Move project zeta' });
  await projectGrip.focus();
  await page.keyboard.press('Space');
  await expect(announcer(page)).toContainText('Picked up project zeta. It is in position 2 of 2.');
  await page.keyboard.press('ArrowUp');
  await expect(announcer(page)).toContainText('project zeta will move to position 1 of 2.');
  await page.keyboard.press('Enter');
  await expect(projectNames(page)).toHaveText(['zeta', 'web']);
  await page.reload();
  await expect(projectNames(page)).toHaveText(['zeta', 'web']);
});

test('reduced motion keeps the drag card still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const project = await createProject(page, 'web');
  await seedChats([{ title: 'Loose idea' }]);
  await page.reload();
  await pickUp(page, row(page, 'Loose idea'));
  await hoverOver(page, block(page, project.name), 'top');
  const card = page.locator('.drag-card');
  await expect(card).toBeVisible();
  expect(await card.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  expect(
    await card.locator('.dc-blob').evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('none');
  await page.mouse.up();
  await expect(block(page, project.name).locator('.row .tt')).toHaveText(['Loose idea']);
});
