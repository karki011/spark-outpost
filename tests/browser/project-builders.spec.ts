import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
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
      'SELECT parallel_pieces, piece_slots, stable_checkout FROM projects WHERE root_path = $1',
      [root],
    );
    return rows[0];
  } finally {
    await db.end();
  }
}

test('turns on parallel Builders for a project and picks how many run at once', async ({
  page,
}) => {
  const name = path.basename(root);
  const linked = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(linked.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Spark' }).getByRole('tab', { name: 'Projects' }).click();
  const builders = page.getByRole('group', { name: `Builders in ${name}` });
  await expect(builders).toContainText(
    'Big plans split into pieces that run at the same time, each in its own worktree.',
  );

  const parallel = builders.getByRole('switch', {
    name: `Let Builders work in parallel in ${name}`,
  });
  await expect(parallel).toBeEnabled();
  await parallel.click();
  await expect(parallel).toHaveAttribute('aria-checked', 'true');
  const slots = builders.getByRole('button', { name: `How many at once in ${name}` });
  await expect(slots).toContainText('Up to 3 at once');
  await slots.click();
  await page.getByRole('menuitemradio', { name: 'Up to 2 at once' }).click();
  await expect(slots).toContainText('Up to 2 at once');
  await expect
    .poll(saved)
    .toEqual({ parallel_pieces: true, piece_slots: 2, stable_checkout: false });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'project-builders.png') });

  await builders.getByRole('switch', { name: `Keep this folder untouched: ${name}` }).click();
  await expect.poll(saved).toMatchObject({ stable_checkout: true });

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Spark' }).getByRole('tab', { name: 'Projects' }).click();
  await expect(parallel).toHaveAttribute('aria-checked', 'true');
  await expect(slots).toContainText('Up to 2 at once');
});
