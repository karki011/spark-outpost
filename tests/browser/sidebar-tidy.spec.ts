import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { archiveInactive } from '../../apps/server/src/workflow/archive-inactive.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-sidebar-tidy-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const projectRow = (page: Page, name: string) =>
  sidebar(page).locator('.pblock', { hasText: name });

async function createProject(page: Page, name: string) {
  const folder = path.join(mkdtempSync(path.join(base, 'p-')), name);
  mkdirSync(folder);
  const response = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; name: string };
}

async function idleFor(conversationId: string, days: number): Promise<void> {
  const db = openTestDb();
  try {
    const ago = `now() - make_interval(days => ${days})`;
    await db.query(`UPDATE conversations SET created_at = ${ago} WHERE id = $1`, [conversationId]);
    await db.query(`UPDATE messages SET created_at = ${ago} WHERE conversation_id = $1`, [
      conversationId,
    ]);
    await db.query(
      `UPDATE runs SET created_at = ${ago}, started_at = ${ago}, finished_at = ${ago}
       WHERE conversation_id = $1`,
      [conversationId],
    );
  } finally {
    await db.end();
  }
}

async function sweep(): Promise<string[]> {
  const db = openTestDb();
  try {
    return await archiveInactive(db, await ensureLocalWorkspace(db));
  } finally {
    await db.end();
  }
}

async function noAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

async function openChatsSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Chats & autonomy' })
    .click();
  const group = page
    .getByRole('dialog', { name: 'Chats & autonomy' })
    .getByRole('radiogroup', { name: 'Archive inactive chats' });
  await group.scrollIntoViewIfNeeded();
  return group;
}

test('Archive inactive chats is After 2 days by default and saves a new choice', async ({
  page,
}) => {
  await openChats(page);
  const group = await openChatsSettings(page);
  await expect(group.getByRole('radio')).toHaveText([
    'After 2 days',
    'After 7 days',
    'After 30 days',
    'Never',
  ]);
  await expect(group.getByRole('radio', { name: 'After 2 days' })).toBeChecked();
  await expect(group).toHaveAccessibleDescription(
    'A chat with no message, turn or answered card for 2 days moves to History. Pinned, working and waiting chats stay.',
  );
  await noAxeViolations(page, 'section[aria-labelledby="chats-list"]');

  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await group.getByRole('radio', { name: 'Never' }).focus();
  await page.keyboard.press('Space');
  await saved;
  await expect(group.getByRole('radio', { name: 'Never' })).toBeChecked();
  await expect(group).toHaveAccessibleDescription('Chats stay in Active until you archive them.');
  const setup = await (await page.request.get('/api/setup')).json();
  expect(setup.profile.archiveInactiveDays).toBeNull();
});

test('an idle chat moves to History with its line, and its empty project leaves the panel', async ({
  page,
}) => {
  await openChats(page);
  const project = await createProject(page, 'billing');
  const [idle] = await seedChats([
    { title: 'Old invoice work', projectIds: [project.id], run: { status: 'succeeded' } },
    { title: 'Fresh loose chat' },
  ]);
  await idleFor(idle!, 3);
  await page.reload();
  await expect(projectRow(page, 'billing').getByRole('listitem')).toHaveText(['Old invoice work']);

  expect(await sweep()).toEqual([idle]);
  await expect(projectRow(page, 'billing')).toHaveCount(0);
  await expect(sidebar(page).getByRole('listitem')).toHaveText(['Fresh loose chat']);

  await sidebar(page)
    .getByRole('tab', { name: /History/ })
    .click();
  const row = sidebar(page).getByRole('button', { name: /^Old invoice work/ });
  await expect(row).toHaveAccessibleName(/Archived after 2 days without activity/);
  await row.click();
  await expect(
    page.getByRole('separator', { name: 'Archived after 2 days without activity' }),
  ).toBeVisible();
});

test('a project with no active chat comes back with the chat started in it', async ({ page }) => {
  await openChats(page);
  await createProject(page, 'atlas');
  await page.reload();
  await expect(sidebar(page).getByRole('button', { name: 'Add project' })).toBeVisible();
  await expect(projectRow(page, 'atlas')).toHaveCount(0);
  await expect(sidebar(page).getByText('No chats yet. Start one with New chat.')).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'New chat', exact: true }).click();
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Choose project' }).click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /^atlas/ }).click();
  await page.keyboard.press('Escape');
  const input = main.getByRole('textbox', { name: 'Message' });
  await input.fill('Map the atlas data');
  await input.press('Enter');

  await expect(projectRow(page, 'atlas').getByRole('listitem')).toHaveText(['Map the atlas data']);
  await expect(
    sidebar(page).getByText('Drag a chat here to take it out of its project.'),
  ).toBeVisible();
});
