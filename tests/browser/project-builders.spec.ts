import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

let root = '';

test.beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-builders-')));
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function saved() {
  const db = openTestDb();
  try {
    const { rows } = await db.query(
      'SELECT parallel_pieces, piece_slots, work_place FROM projects WHERE root_path = $1',
      [root],
    );
    return rows[0];
  } finally {
    await db.end();
  }
}

async function openProjects(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Spark' }).getByRole('tab', { name: 'Projects' }).click();
}

async function shoot(page: Page, skin: string, file: string) {
  await page.evaluate((theme) => (document.documentElement.dataset.skin = theme), skin);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page
    .locator('.set-project')
    .first()
    .screenshot({ path: path.join(SHOTS, file) });
}

test('Builders run in parallel by default; pick how many at once and where Spark works', async ({
  page,
}) => {
  const name = path.basename(root);
  const linked = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(linked.ok()).toBe(true);
  expect(await saved()).toEqual({ parallel_pieces: true, piece_slots: 3, work_place: 'worktree' });
  await page.goto('/');
  await openProjects(page);
  const builders = page.getByRole('group', { name: `Builders in ${name}` });
  await expect(builders).toContainText('run at the same time');
  await expect(builders.getByRole('switch')).toHaveCount(0);

  const slots = builders.getByRole('button', { name: `Builders at once in ${name}` });
  await expect(slots).toContainText('Up to 3 at once');
  const place = builders.getByRole('button', { name: `Where Spark works in ${name}` });
  await expect(place).toContainText('Each chat in its own worktree (recommended)');
  if (SHOTS) {
    await shoot(page, 'light', 'builders-light.png');
    await shoot(page, 'dark', 'builders-dark.png');
  }

  await slots.click();
  await page.getByRole('menuitemradio', { name: '1 at a time, in order' }).click();
  await expect(slots).toContainText('1 at a time, in order');
  await expect(builders).toContainText('Pieces of a big plan run one after another.');
  await expect.poll(saved).toMatchObject({ piece_slots: 1 });

  await place.click();
  await page.getByRole('menuitemradio', { name: 'In my files' }).click();
  await expect(place).toContainText('In my files');
  await expect
    .poll(saved)
    .toEqual({ parallel_pieces: true, piece_slots: 1, work_place: 'checkout' });

  await page.reload();
  await openProjects(page);
  await expect(slots).toContainText('1 at a time, in order');
  await expect(place).toContainText('In my files');
});
