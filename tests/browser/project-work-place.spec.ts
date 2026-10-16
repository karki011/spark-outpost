import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';

let root = '';

test.beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-work-place-')));
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function savedPlace(): Promise<string | undefined> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ work_place: string }>(
      'SELECT work_place FROM projects WHERE root_path = $1',
      [root],
    );
    return rows[0]?.work_place;
  } finally {
    await db.end();
  }
}

async function openProjects(page: Page, name: string) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Projects' })
    .click();
  const row = page
    .getByRole('list', { name: 'Linked folders' })
    .getByRole('button', { name: new RegExp(`^${name}\\b`) });
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.click();
}

test('a project starts with a worktree per chat, and In my files is remembered', async ({
  page,
}) => {
  const name = path.basename(root);
  const linked = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(linked.ok()).toBe(true);
  expect(await savedPlace()).toBe('worktree');
  await page.goto('/');
  await openProjects(page, name);
  const place = page.getByRole('button', { name: `Where Spark works in ${name}` });
  await expect(place).toContainText('Each chat in its own worktree (recommended)');
  await expect(page.getByRole('button', { name: `Builders at once in ${name}` })).toHaveCount(0);

  await place.click();
  await page.getByRole('menuitemradio', { name: 'In my files' }).click();
  await expect(place).toContainText('In my files');
  await expect.poll(savedPlace).toBe('checkout');

  await page.reload();
  await openProjects(page, name);
  await expect(place).toContainText('In my files');
});
