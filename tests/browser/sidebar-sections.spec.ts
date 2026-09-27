import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';
import { openChats } from './navigation.ts';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-sections-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const chatsBlock = (page: Page) => sidebar(page).locator('.cblock');
const buckets = (page: Page) => chatsBlock(page).locator('.fold.bucket');
const row = (page: Page, title: string) =>
  sidebar(page).getByRole('listitem').filter({ hasText: title });
const toggles = (page: Page) =>
  page.locator('button:is(.side-toggle, .side-collapse):not([inert] *)');
const header = (page: Page, label: string) =>
  sidebar(page).getByRole('button', { name: label, exact: true });

function minutesSinceNoon(daysAgo: number): number {
  const now = new Date();
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12);
  return Math.round((now.getTime() - noon.getTime()) / 60_000);
}

function monthLabel(daysAgo: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12);
  const year = date.getFullYear() === now.getFullYear() ? undefined : 'numeric';
  return new Intl.DateTimeFormat('en-US', { month: 'long', year }).format(date);
}

async function createProject(page: Page): Promise<{ id: string; name: string }> {
  const folder = path.join(base, `web-${Date.now()}`);
  mkdirSync(folder);
  const response = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; name: string };
}

test('loose chats group by last activity below a divider, project chats stay flat', async ({
  page,
}) => {
  const project = await createProject(page);
  await seedChats([
    { title: 'Fresh idea', minutesAgo: 1 },
    { title: 'Yesterday chat', minutesAgo: minutesSinceNoon(1) },
    { title: 'Last week chat', minutesAgo: minutesSinceNoon(4) },
    { title: 'Last month chat', minutesAgo: minutesSinceNoon(15) },
    { title: 'Old chat', minutesAgo: minutesSinceNoon(70) },
    { title: 'Old project chat', minutesAgo: minutesSinceNoon(70), projectIds: [project.id] },
  ]);
  await openChats(page);
  await expect(buckets(page)).toHaveCount(5);
  const labels = await buckets(page).evaluateAll((sections) =>
    sections.map((section) => section.getAttribute('aria-label')),
  );
  expect(labels).toEqual([
    'Today',
    'Yesterday',
    'Previous 7 days',
    'Previous 30 days',
    monthLabel(70),
  ]);
  await expect(buckets(page).nth(1).locator('.row .tt')).toHaveText(['Yesterday chat']);

  const group = sidebar(page).locator('.pblock', { hasText: project.name });
  await expect(group.locator('.row')).toHaveCount(1);
  await expect(group.locator('.fold')).toHaveCount(0);
  await expect(row(page, 'Old project chat').locator('.row-open')).toHaveAttribute(
    'title',
    `Old project chat · ${monthLabel(70)}`,
  );
});

test('date buckets collapse, remember it, and open while searching', async ({ page }) => {
  await seedChats([
    { title: 'Fresh idea', minutesAgo: 1 },
    { title: 'Yesterday chat', minutesAgo: minutesSinceNoon(1) },
  ]);
  await openChats(page);
  await expect(sidebar(page).getByRole('group', { name: 'Chats' })).toBeVisible();
  await expect(sidebar(page).locator('.cblock .sec-head', { hasText: 'Chats' })).toHaveCount(0);

  const yesterday = header(page, 'Yesterday');
  await expect(yesterday).toHaveAttribute('aria-expanded', 'true');
  await yesterday.click();
  await expect(yesterday).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 'Yesterday chat')).toBeHidden();
  await expect(row(page, 'Fresh idea')).toBeVisible();

  await page.reload();
  await expect(header(page, 'Yesterday')).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 'Yesterday chat')).toBeHidden();
  await header(page, 'Today').press('Enter');
  await expect(row(page, 'Fresh idea')).toBeHidden();

  await page.getByRole('searchbox', { name: 'Search chats' }).fill('chat');
  await expect(row(page, 'Yesterday chat')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search chats' }).fill('');
  await header(page, 'Today').click();
  await header(page, 'Yesterday').click();
  await expect(row(page, 'Fresh idea')).toBeVisible();
  await expect(row(page, 'Yesterday chat')).toBeVisible();
});

const LONG_TITLE =
  'Move the date formatting helpers into a shared module and update every caller in the app';

test('long titles scroll on hover and keyboard focus, short ones stay still', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedChats([
    { title: 'Short one', minutesAgo: 1 },
    { title: LONG_TITLE, minutesAgo: 2 },
  ]);
  await openChats(page);
  const long = row(page, LONG_TITLE).locator('.tt');
  const short = row(page, 'Short one').locator('.tt');
  await expect(long).toHaveAttribute('data-truncated', 'true');
  await expect(short).not.toHaveAttribute('data-truncated');
  await expect(row(page, LONG_TITLE).locator('.row-open')).toHaveAttribute(
    'title',
    new RegExp(`^${LONG_TITLE}`),
  );

  await row(page, LONG_TITLE).hover();
  await expect(long).toHaveAttribute('data-marquee', 'true');
  await page.mouse.move(900, 400);
  await expect(long).not.toHaveAttribute('data-marquee');

  await row(page, 'Short one').locator('.row-open').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Move Short one' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(row(page, LONG_TITLE).locator('.row-open')).toBeFocused();
  await expect(long).toHaveAttribute('data-marquee', 'true');
  await expect(short).not.toHaveAttribute('data-marquee');
});

test('reduced motion keeps long titles still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedChats([{ title: LONG_TITLE }]);
  await openChats(page);
  const long = row(page, LONG_TITLE).locator('.tt');
  await expect(long).toHaveAttribute('data-truncated', 'true');
  await row(page, LONG_TITLE).hover();
  await page.waitForTimeout(700);
  await expect(long).not.toHaveAttribute('data-marquee');
});

test('⌘B, the sidebar button and the Chats rail button collapse and reopen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedChats([{ title: 'First chat' }]);
  await openChats(page);
  const hide = sidebar(page).getByRole('button', { name: 'Hide sidebar' });
  const show = page.getByRole('main').getByRole('button', { name: 'Show sidebar' });
  await expect(hide).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+B$/);
  await expect(toggles(page)).toHaveCount(1);
  await expect(show).toHaveCount(0);
  expect((await sidebar(page).boundingBox())?.width).toBe(300);

  await page.getByRole('textbox', { name: 'Message' }).focus();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(sidebar(page)).toHaveJSProperty('inert', true);
  await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(0);
  await page.reload();
  await expect(sidebar(page)).toHaveJSProperty('inert', true);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(sidebar(page)).toHaveJSProperty('inert', false);

  await hide.click();
  await expect(sidebar(page)).toHaveJSProperty('inert', true);
  await expect(show).toBeFocused();
  await expect(toggles(page)).toHaveCount(1);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(hide).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Hide sidebar');
  await expect(page.getByRole('tooltip').locator('kbd')).toHaveText([/⌘|Ctrl/, 'B']);
  await hide.click();
  await expect(show).toBeFocused();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Chats' })
    .click();
  await expect(sidebar(page)).toHaveJSProperty('inert', false);
  await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(300);
});

test('the default width is 280px below 1240px', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await openChats(page);
  expect((await sidebar(page).boundingBox())?.width).toBe(280);
});

test('collapsing keeps the thread where it was and leaves one sidebar button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const brief = Array.from({ length: 80 }, (_, index) => `Point ${index + 1} of the brief.`);
  await seedChats([
    { title: 'Long brief', message: brief.join('\n\n'), run: { status: 'succeeded' } },
  ]);
  await openChats(page);
  const thread = page.locator('.thread');
  await expect(thread).toContainText('Point 80 of the brief.');
  await thread.evaluate((element) => (element.scrollTop = 400));
  const scrollTop = () => thread.evaluate((element) => element.scrollTop);
  expect(await scrollTop()).toBe(400);

  await sidebar(page).getByRole('button', { name: 'Hide sidebar' }).click();
  await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(0);
  expect(await scrollTop()).toBe(400);
  await expect(toggles(page)).toHaveCount(1);
  await expect(page.getByRole('main').getByRole('button', { name: 'Show sidebar' })).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: 'Show sidebar' }).click();
  await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(300);
  expect(await scrollTop()).toBe(400);
  await expect(toggles(page)).toHaveCount(1);
  await expect(sidebar(page).getByRole('button', { name: 'Hide sidebar' })).toBeFocused();
});
