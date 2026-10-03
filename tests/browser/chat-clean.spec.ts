import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { shoot, useSystemTheme } from './docs-seed.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.CHAT_CLEAN_SHOTS ?? '';

const ANSWER = [
  "I can't open the repo's files from this chat because it isn't linked to a project.",
  '',
  '## feature-web-apps',
  '- **GitHub:** `acme/feature-web-apps`, default branch `main`',
  '- **Local path:** `~/Documents/feature-web-apps`',
  '- **No Spark chats yet** in this project',
  '- **The Map is still being built**',
  '',
  '| PR | Author | State |',
  '| --- | --- | --- |',
  '| #2182 | you | merged yesterday, adds "contains" filters to AI Signals Overview |',
  '| #2183 | ben-dalton | draft, CI failing on greptile-gate |',
  '',
  '```sh',
  'gh pr list --repo acme/feature-web-apps --state open --json number,title,author,isDraft',
  '```',
  '',
  'To dig into the code, start a chat in the **feature-web-apps** project.',
].join('\n');

async function sql<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<T>(text, values);
    return rows;
  } finally {
    await db.end();
  }
}

async function emit(runId: string, event: Record<string, unknown>) {
  await sql(
    `INSERT INTO run_events (run_id, seq, type, payload)
     SELECT $1, coalesce(max(seq), 0) + 1, $2, $3 FROM run_events WHERE run_id = $1`,
    [runId, event.type, JSON.stringify(event)],
  );
}

async function step(runId: string, stepName: string, done = true) {
  await emit(runId, { type: 'STEP_STARTED', stepName });
  if (done) await emit(runId, { type: 'STEP_FINISHED', stepName });
}

async function questionChat(status: 'running' | 'succeeded') {
  const [chatId] = await seedChats([{ title: 'Current Spark activity', run: { status } }]);
  const [run] = await sql<{ id: string }>(
    `UPDATE runs SET provider = 'claude', model = 'Opus 5.5', effort = 'medium',
       category = 'question', started_at = now() - interval '19 seconds'
     WHERE conversation_id = $1 RETURNING id`,
    [chatId],
  );
  const runId = run!.id;
  await emit(runId, { type: 'RUN_STARTED', runId, threadId: chatId });
  await step(runId, 'Using Opus 5.5 · medium effort');
  await step(runId, 'mcp__spark__spark_projects');
  await step(runId, 'mcp__spark__spark_map');
  return { chatId: chatId!, runId };
}

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  await shoot(page, SHOTS, name, page.locator('.main'));
}

const head = (page: Page) => page.locator('.msg.ai .ai-head').last();
const status = (page: Page) => page.locator('.cstatus .cs-wrap');

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  if (SHOTS) await useSystemTheme(page);
});

test('a running turn has one status, with steps in plain words', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { runId } = await questionChat('running');
  await step(runId, 'mcp__spark__spark_pull_requests', false);
  await openChats(page);

  await expect(head(page).locator('.mood')).toHaveText('working');
  const toggle = head(page).getByRole('button', { name: '4 steps' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.steps li')).toHaveText([
    'Using Opus 5.5 · medium effort',
    'Looking at projects',
    'Reading the project map',
    'Checking pull requests',
  ]);
  await expect(page.locator('.thread')).not.toContainText('mcp__');
  await expect(page.locator('.thread .dots')).toHaveCount(0);
  await expect(status(page)).toHaveText('Claude is working · Checking pull requests');
  await expect(page.getByText(/^Working$/)).toHaveCount(0);
  await shots(page, 'running');

  await toggle.click();
  await expect(page.locator('.steps li')).toHaveCount(0);
});

test('a finished answer keeps one quiet meta row and no plan or Jev lines', async ({ page }) => {
  const { chatId, runId } = await questionChat('succeeded');
  await sql(
    `UPDATE runs SET finished_at = started_at + interval '19 seconds', input_tokens = 61000,
       output_tokens = 900, cost_usd = 0.05, cost_source = 'reported'
     WHERE id = $1`,
    [runId],
  );
  await sql(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     VALUES (gen_random_uuid(), $1, 'assistant', $2, $3)`,
    [chatId, ANSWER, runId],
  );
  await emit(runId, { type: 'RUN_FINISHED', runId, threadId: chatId });
  await page.setViewportSize({ width: 2000, height: 1100 });
  await openChats(page);

  await expect(head(page).locator('.mood')).toHaveText('done');
  await expect(head(page).getByRole('button', { name: 'worked for 19s' })).toBeVisible();
  await expect(head(page).locator('.cat-chip')).toHaveText('Question');
  await expect(page.getByRole('button', { name: 'Save as agreed plan' })).toHaveCount(0);
  await expect(page.getByText(/^Jev:/)).toHaveCount(0);
  await expect(page.locator('.taskc')).toHaveCount(0);
  await expect(page.locator('.turn-foot .run-usage')).toContainText('61');
  await expect(page.locator('.ctx-unlinked')).toHaveText(
    "Not linked, so the agent can't read files",
  );

  const column = (await page.locator('.col').boundingBox())!;
  const composer = (await page.locator('.composer').boundingBox())!;
  expect(column.width).toBeGreaterThan(860);
  expect(Math.abs(column.width - composer.width)).toBeLessThan(2);
  await shots(page, 'finished-wide');

  await page.setViewportSize({ width: 1280, height: 900 });
  const narrow = (await page.locator('.col').boundingBox())!;
  const thread = (await page.locator('.thread').boundingBox())!;
  expect(narrow.width).toBeLessThanOrEqual(thread.width);
  await page.setViewportSize({ width: 600, height: 900 });
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scroll).toBe(0);
});

test('Agent TV is there for a plain answer and shows the agent that answered', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openChats(page);
  await expect(page.getByRole('button', { name: 'Agent TV' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('What is a worktree?');
  await input.press('Enter');
  await expect(head(page).locator('.mood')).toHaveText('done', { timeout: 20_000 });
  const button = page.getByRole('button', { name: 'Agent TV' });
  await button.click();
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect(tv).toBeVisible();
  await shots(page, 'agent-tv-solo');
  await tv.getByRole('button', { name: 'Close Agent TV' }).click();
  await expect(tv).toBeHidden();
});
