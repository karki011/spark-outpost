import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import { seedPrFollowUp } from './pr-follow-up-seed.ts';
import { seedChats } from './sidebar-seed.ts';
import { openChats } from './navigation.ts';

const REVIEW_SHOTS = process.env.REVIEW_SHOTS ?? '';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-sidebar-')));
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
const rowTitles = (scope: Locator) => scope.locator('.row .tt');
const toast = (page: Page, text: string) =>
  sidebar(page).getByRole('status').filter({ hasText: text });

async function createProject(page: Page, name: string): Promise<string> {
  const folder = path.join(base, `${name}-${Date.now()}`);
  mkdirSync(folder);
  const response = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string; name: string }).name;
}

async function openMenu(page: Page, title: string) {
  await row(page, title).hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for ${title}` })
    .click();
  return page.getByRole('menu', { name: `Options for ${title}` });
}

test('search filters chats by title and message text', async ({ page }) => {
  await seedChats([
    { title: 'Fix the date divider' },
    { title: 'Tray icon states', message: 'Draw the offline badge' },
    { title: 'Worktree cleanup' },
  ]);
  await openChats(page);
  await expect(rowTitles(sidebar(page))).toHaveText([
    'Fix the date divider',
    'Tray icon states',
    'Worktree cleanup',
  ]);

  const search = page.getByRole('searchbox', { name: 'Search chats' });
  await search.fill('DIVIDER');
  await expect(rowTitles(sidebar(page))).toHaveText(['Fix the date divider']);
  await search.fill('offline badge');
  await expect(rowTitles(sidebar(page))).toHaveText(['Tray icon states']);
  await search.fill('nothing like this');
  await expect(sidebar(page)).toContainText('No active chats match “nothing like this”.');
  await search.press('Escape');
  await expect(rowTitles(sidebar(page))).toHaveCount(3);

  await page.getByRole('textbox', { name: 'Message' }).focus();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search).toBeFocused();
});

test('archives with undo and moves chats between the Active and History tabs', async ({ page }) => {
  await seedChats([{ title: 'Release notes' }, { title: 'Old spike', archived: true }]);
  await openChats(page);
  const tabs = sidebar(page).getByRole('tablist', { name: 'Chat lists' });
  await expect(tabs.getByRole('tab', { name: /Active/ })).toHaveText('Active 1');
  await expect(tabs.getByRole('tab', { name: /History/ })).toHaveText('History 1');

  await (await openMenu(page, 'Release notes')).getByRole('menuitem', { name: 'Archive' }).click();
  await expect(toast(page, 'Archived Release notes')).toBeVisible();
  await expect(row(page, 'Release notes')).toHaveCount(0);
  await toast(page, 'Archived Release notes').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Release notes')).toBeVisible();

  await (await openMenu(page, 'Release notes')).getByRole('menuitem', { name: 'Archive' }).click();
  await expect(tabs.getByRole('tab', { name: /History/ })).toHaveText('History 2');
  await tabs.getByRole('tab', { name: /History/ }).click();
  await expect(tabs.getByRole('tab', { name: /History/ })).toHaveAttribute('aria-selected', 'true');
  await expect(sidebar(page).getByRole('region', { name: 'Today' })).toContainText('Release notes');
  await row(page, 'Release notes').hover();
  await sidebar(page).getByRole('button', { name: 'Restore Release notes' }).click();
  await expect(toast(page, 'Restored Release notes to Active')).toBeVisible();
  await tabs.getByRole('tab', { name: /Active/ }).click();
  await expect(row(page, 'Release notes')).toBeVisible();

  await page.reload();
  await expect(tabs.getByRole('tab', { name: /History/ })).toHaveText('History 1');
});

test('renames inline, pins to the top, and deletes after a confirmation with undo @packaged', async ({
  page,
}) => {
  await seedChats([{ title: 'Newest chat' }, { title: 'Second chat' }, { title: 'Third chat' }]);
  await openChats(page);

  await (await openMenu(page, 'Third chat')).getByRole('menuitem', { name: 'Rename' }).click();
  const name = sidebar(page).getByRole('textbox', { name: 'Chat name' });
  await expect(name).toBeFocused();
  await name.fill('Renamed chat');
  await name.press('Enter');
  await expect(row(page, 'Renamed chat')).toBeVisible();

  await (await openMenu(page, 'Renamed chat')).getByRole('menuitem', { name: 'Pin' }).click();
  await expect(rowTitles(sidebar(page)).first()).toHaveText('Renamed chat');
  await expect(row(page, 'Renamed chat').getByRole('img', { name: 'Pinned' })).toBeAttached();
  await page.reload();
  await expect(rowTitles(sidebar(page))).toHaveText(['Renamed chat', 'Newest chat', 'Second chat']);

  const menu = await openMenu(page, 'Second chat');
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(row(page, 'Second chat')).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Confirm delete' }).click();
  await expect(row(page, 'Second chat')).toHaveCount(0);
  await expect(toast(page, 'Deleted Second chat')).toBeVisible();
  await toast(page, 'Deleted Second chat').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Second chat')).toBeVisible();

  await (await openMenu(page, 'Second chat')).getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('menuitem', { name: 'Confirm delete' }).press('Enter');
  await expect(toast(page, 'Deleted Second chat')).toBeHidden({ timeout: 8_000 });
  await page.reload();
  await expect(rowTitles(sidebar(page))).toHaveText(['Renamed chat', 'Newest chat']);
});

test('deleting the open chats one after another never lands back on a deleted chat', async ({
  page,
}) => {
  await seedChats([{ title: 'Newest chat' }, { title: 'Second chat' }]);
  await openChats(page);
  const header = page.getByRole('main').getByRole('heading', { level: 1 });

  await row(page, 'Newest chat').click();
  await expect(header).toHaveText('Newest chat');
  await (await openMenu(page, 'Newest chat')).getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('menuitem', { name: 'Confirm delete' }).click();
  await expect(header).toHaveText('Second chat');

  await (await openMenu(page, 'Second chat')).getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('menuitem', { name: 'Confirm delete' }).click();
  await expect(header).not.toHaveText(/Newest chat|Second chat/);
  await expect(page.getByRole('textbox', { name: /Ask anything|Message/ })).toBeVisible();
});

async function dragTo(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Drag source or target is not visible.');
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + from.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to.x + 60, to.y + 12, { steps: 8 });
  await expect(target).toHaveClass(/over/);
  await page.mouse.up();
}

test('drags a chat into a project and back out, with keyboard moves in the menu', async ({
  page,
}) => {
  await seedChats([{ title: 'Loose chat' }]);
  await openChats(page);
  const project = await createProject(page, 'web-apps');
  await page.reload();
  const group = sidebar(page).locator('.pblock', { hasText: project });
  await expect(group.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();

  await dragTo(page, row(page, 'Loose chat'), group);
  await expect(group.getByRole('listitem')).toHaveText(['Loose chat']);
  await expect(toast(page, `Moved to ${project}`)).toBeVisible();
  await expect(page.locator('.crumb')).toHaveText(`${project} /`);

  const chatsBlock = sidebar(page).locator('.cblock');
  await dragTo(page, row(page, 'Loose chat'), chatsBlock);
  await expect(chatsBlock.getByRole('listitem')).toHaveText(['Loose chat']);
  await expect(toast(page, `Removed from ${project}`)).toBeVisible();
  await toast(page, `Removed from ${project}`).getByRole('button', { name: 'Undo' }).click();
  await expect(group.getByRole('listitem')).toHaveText(['Loose chat']);

  const menu = await openMenu(page, 'Loose chat');
  await menu.getByRole('menuitem', { name: 'Move to project' }).focus();
  await page.keyboard.press('ArrowRight');
  const moveMenu = page.getByRole('menu', { name: 'Move to project' });
  await expect(moveMenu.getByRole('menuitemradio', { name: project })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await moveMenu.getByRole('menuitemradio', { name: 'No project' }).click();
  await expect(chatsBlock.getByRole('listitem')).toHaveText(['Loose chat']);

  await group.getByRole('button', { name: new RegExp(`^${project}`) }).click();
  await expect(group).not.toHaveClass(/open/);
  await page.reload();
  await expect(sidebar(page).locator('.pblock', { hasText: project })).not.toHaveClass(/open/);
});

test('row states and the attention banner jump to the chat that needs input', async ({ page }) => {
  await seedChats([
    { title: 'Current chat', run: { status: 'succeeded' } },
    { title: 'Deploy the site', run: { status: 'awaiting_approval' } },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' } },
  ]);
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText('Current chat');

  await expect(row(page, 'Deploy the site')).toHaveClass(/st-asking/);
  await expect(row(page, 'Deploy the site').locator('.row-open')).toHaveAttribute(
    'title',
    /Needs your input/,
  );
  await expect(row(page, 'Mock fetch').locator('.row-open')).toHaveAttribute(
    'title',
    /Stopped with an error/,
  );
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByLabel('1 chat needs your input'),
  ).toHaveText('1');

  const banner = sidebar(page).getByRole('button', {
    name: 'Deploy the site needs your input Needs your input',
    exact: true,
  });
  await banner.click();
  await expect(page.locator('.chat-title')).toHaveText('Deploy the site');
  await expect(banner).not.toBeVisible();
});

test('collapses the sidebar, remembers it, and opens a drawer on small screens', async ({
  page,
}) => {
  await seedChats([{ title: 'First chat' }, { title: 'Second chat' }]);
  await openChats(page);
  await sidebar(page).getByRole('button', { name: 'Hide sidebar' }).click();
  await expect(sidebar(page)).toHaveJSProperty('inert', true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(sidebar(page)).toHaveJSProperty('inert', false);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeInViewport();
  await expect(sidebar(page)).not.toBeInViewport();
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(sidebar(page)).toBeInViewport();
  await row(page, 'Second chat').getByRole('button', { name: 'Second chat', exact: true }).click();
  await expect(page.locator('.chat-title')).toHaveText('Second chat');
  await expect(sidebar(page)).not.toBeInViewport();

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Tickets' })
    .click();
  await expect(page.getByRole('heading', { name: 'See your tickets here' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Chats/ })
    .click();
  await expect(page.locator('.chat-title')).toHaveText('Second chat');
});

test('a chat whose pull request merged shows a merged icon beside its title', async ({ page }) => {
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await seedPrFollowUp();
  await openChats(page);
  const chat = row(page, 'Fix the cents parser');
  await expect(chat).toBeVisible();
  const merged = chat.getByRole('img', { name: 'Pull request merged' });
  await expect(merged).toHaveCount(0);

  const db = openTestDb();
  try {
    await db.query(`UPDATE pr_watches SET pr_state = 'merged', phase = 'done'`);
  } finally {
    await db.end();
  }
  await page.reload();
  await expect(merged).toBeVisible();
  const title = (await chat.locator('.tt').boundingBox())!;
  const icon = (await merged.boundingBox())!;
  const line = (await chat.boundingBox())!;
  expect(icon.x).toBeGreaterThanOrEqual(title.x + title.width);
  expect(icon.x - (title.x + title.width)).toBeLessThanOrEqual(8);
  expect(icon.x + icon.width).toBeLessThanOrEqual(line.x + line.width);
  expect(await merged.evaluate((mark) => getComputedStyle(mark).color)).toBe(
    await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = 'var(--accent-text)';
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }),
  );

  await merged.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Pull request merged');
  if (REVIEW_SHOTS) {
    mkdirSync(REVIEW_SHOTS, { recursive: true });
    await page.screenshot({ path: `${REVIEW_SHOTS}/sidebar-merged-icon.png` });
  }
});
