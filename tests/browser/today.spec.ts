import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const GREETING = /^(Good (morning|afternoon|evening)|Working late), Test$/;

const PAYLOAD = { command: null, cwd: null, paths: [], diffs: [], truncated: false };

let root = '';

test.beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-today-')));
  writeFileSync(path.join(root, 'README.md'), '# Today fixture\n');
  writeFileSync(path.join(root, 'CLAUDE.md'), 'Run the tests before you finish.\n');
  mkdirSync(path.join(root, '.claude', 'commands'), { recursive: true });
  writeFileSync(path.join(root, '.claude', 'commands', 'ship.md'), 'Ship the change.\n');
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const today = (page: Page) => page.getByRole('region', { name: 'Today so far' });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(composer(page)).toBeFocused();
}

async function keepAndOpenPr(conversationId: string) {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM runs WHERE conversation_id = $1 LIMIT 1',
      [conversationId],
    );
    const runId = rows[0]!.id;
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash,
         options, status, decision_option_id, scope, decided_by, decided_at)
       VALUES ($1, $2, $3, 'accept', 'Keep these changes?', $4, 'hash', '[]', 'allowed',
         'keep', 'once', 'user', now())`,
      [randomUUID(), runId, `checkpoint:accept:${randomUUID()}`, JSON.stringify(PAYLOAD)],
    );
    const taskId = randomUUID();
    await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      conversationId,
      'Login fix',
    ]);
    await db.query(
      `INSERT INTO task_ships (task_id, root_path, branch, pr_url, pr_number)
       VALUES ($1, $2, 'spark/login', 'https://github.com/o/r/pull/9', 9)`,
      [taskId, root],
    );
  } finally {
    await db.end();
  }
}

async function seedDay() {
  const [login, docs] = await seedChats([
    { title: 'Fix the login bug', run: { status: 'succeeded' } },
    { title: 'Update the docs', run: { status: 'succeeded' } },
  ]);
  await decorateLatestRun(login!, { provider: 'claude', costUsd: 0.42 });
  await decorateLatestRun(docs!, { provider: 'claude', costUsd: 0.08 });
  await keepAndOpenPr(login!);
}

async function within(page: Page, target: Locator, frame: Locator) {
  const box = await target.boundingBox();
  const bounds = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(bounds).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
}

async function linkProject(page: Page) {
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(root)}`) }).click();
  await page.keyboard.press('Escape');
  const kit = page.getByRole('region', { name: /gives the agents$/ });
  await expect(kit.getByRole('button').first()).toBeVisible();
  return kit;
}

test('greets by name and says so when nothing else happened today', async ({ page }) => {
  await newChat(page);
  await expect(page.getByRole('heading', { name: GREETING })).toBeVisible();
  await expect(page.getByText('What should we work on?')).toBeVisible();
  await expect(today(page)).toContainText('Nothing else on the go today. A fresh start.');
  await expect(today(page).getByRole('list')).toHaveCount(0);
});

test('shows what happened today and opens a chat from it', async ({ page }) => {
  await seedDay();
  await newChat(page);
  const numbers = today(page).getByRole('list', { name: 'Today in numbers' });
  await expect(numbers).toHaveText(/2 chats\s*1 change kept\s*1 PR\s*\$0\.50 spent/);
  const chats = today(page).getByRole('list', { name: 'Chats from today' });
  await expect(chats.getByRole('button')).toHaveCount(2);
  await expect(chats.getByRole('button', { name: /Fix the login bug/ })).toContainText(
    '1 kept · 1 PR',
  );

  await chats.getByRole('button', { name: /Fix the login bug/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Fix the login bug' })).toBeVisible();
  await expect(today(page)).toHaveCount(0);
});

test('fits a laptop screen with the project kit and the composer', async ({ page }) => {
  await seedDay();
  const linked = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(linked.ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await newChat(page);
  const kit = await linkProject(page);
  const scroller = page.locator('.thread');
  await expect(today(page).getByRole('button', { name: /Update the docs/ })).toBeVisible();
  await within(page, today(page), scroller);
  await within(page, kit.getByRole('button').first(), scroller);
  await within(page, composer(page), page.locator('body'));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'today-laptop.png') });
});

test('collapses to the two latest chats on a phone', async ({ page }) => {
  await seedChats([
    { title: 'Oldest chat', run: { status: 'succeeded' }, minutesAgo: 30 },
    { title: 'Middle chat', run: { status: 'succeeded' }, minutesAgo: 20 },
    { title: 'Newest chat', run: { status: 'failed', error: 'Boom' }, minutesAgo: 10 },
  ]);
  await newChat(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.app.drawer')).toHaveCount(0);
  const chats = today(page).getByRole('list', { name: 'Chats from today' });
  await expect(chats.getByRole('button', { name: /Newest chat/ })).toContainText('Failed');
  await expect(chats.getByRole('button', { name: /Middle chat/ })).toBeVisible();
  await expect(chats.getByRole('button', { name: /Oldest chat/ })).toBeHidden();
  await within(page, today(page), page.locator('.thread'));
  await within(page, composer(page), page.locator('body'));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'today-phone.png') });
});
