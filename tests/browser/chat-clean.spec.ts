import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { shoot, useSystemTheme } from './docs-seed.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';
import { expectNoHeaderPane, toggleHeaderPane } from './header-menu.ts';
import { COLUMN } from './chat-rail-kit.ts';

const SHOTS = process.env.CHAT_CLEAN_SHOTS ?? '';

const ANSWER = [
  "I can't open the repo's files from this chat because it isn't linked to a project.",
  '',
  '## orders-web-app',
  '- **GitHub:** `acme/orders-web-app`, default branch `main`',
  '- **Local path:** `~/Documents/orders-web-app`',
  '- **No Spark chats yet** in this project',
  '- **The Map is still being built**',
  '',
  '| PR | Author | State |',
  '| --- | --- | --- |',
  '| #2182 | you | merged yesterday, adds "contains" filters to Order Insights Overview |',
  '| #2183 | ben-dalton | draft, CI failing on greptile-gate |',
  '',
  '```sh',
  'gh pr list --repo acme/orders-web-app --state open --json number,title,author,isDraft',
  '```',
  '',
  'To dig into the code, start a chat in the **orders-web-app** project.',
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
    `UPDATE runs SET provider = 'claude', model = 'claude-opus-5-5', effort = 'medium',
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

const mood = (page: Page) => page.locator('.msg.ai .mood').last();
const rows = (page: Page) => page.locator('.msg.ai .trows').last().locator('.trow');
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

  await expect(mood(page)).toHaveText('working');
  await expect(rows(page)).toHaveText([
    'Looking at projects',
    'Reading the project map',
    'Checking pull requests',
  ]);
  await expect(rows(page).last().getByRole('img', { name: 'In progress' })).toBeVisible();
  await expect(page.locator('.msg.ai .ai-head')).toHaveCount(0);
  await expect(page.locator('.thread')).not.toContainText('mcp__');
  await expect(page.locator('.thread')).not.toContainText('medium effort');
  await expect(page.locator('.thread .dots')).toHaveCount(0);
  const working = page.locator('.turn-working');
  await expect(working).toContainText('Checking pull requests');
  await expect(working).toContainText('Esc to stop');
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator('.cstatus').getByRole('status')).toHaveText(
    'Claude is working: Checking pull requests',
  );
  await shots(page, 'running');
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

  await expect(mood(page)).toHaveText('done');
  await expect(page.locator('.msg.ai .ai-head')).toHaveCount(0);
  await expect(page.locator('.turn-meta')).toContainText('Opus 5.5 · 19s');
  await expect(page.getByRole('button', { name: 'Save as agreed plan' })).toHaveCount(0);
  await expect(page.getByText(/^Jev:/)).toHaveCount(0);
  await expect(page.locator('.todo-card, .todo-line')).toHaveCount(0);
  await expect(page.locator('.turn-meta .run-usage')).toContainText('61');
  await expect(
    page.locator('.comp-foot').getByRole('button', { name: 'Choose project' }),
  ).toBeVisible();

  const column = (await page.locator('.col').boundingBox())!;
  const composer = (await page.locator('.composer').boundingBox())!;
  expect(column.width).toBe(COLUMN);
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
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expectNoHeaderPane(page, 'Agent TV');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('What is a worktree?');
  await input.press('Enter');
  await expect(mood(page)).toHaveText('done', { timeout: 20_000 });
  await toggleHeaderPane(page, 'Agent TV');
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect(tv).toBeVisible();
  await shots(page, 'agent-tv-solo');
  await tv.getByRole('button', { name: 'Close Agent TV' }).click();
  await expect(tv).toBeHidden();
});

test('an edit step shows its diff, opens by keyboard, hides a secret file and survives a reload', async ({
  page,
}) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Tidy the notes #diffs');
  await input.press('Enter');
  const turn = page.locator('.msg.ai').last();
  await expect(turn).toHaveAttribute('data-state', 'succeeded', { timeout: 30_000 });

  const notes = turn.getByRole('button', { name: /src\/notes\.ts/ });
  await expect(notes).toHaveAttribute('aria-expanded', 'false');
  await expect(notes).toContainText('+2');
  await notes.focus();
  await page.keyboard.press('Enter');
  await expect(notes).toHaveAttribute('aria-expanded', 'true');
  await expect(turn.locator('.sdiff-body')).toContainText('three');

  await expect(turn).toContainText('Contents hidden: secret file');
  await expect(turn.getByRole('button', { name: /\.env/ })).toHaveCount(0);

  await page.reload();
  const again = page.locator('.msg.ai').last();
  const kept = again.getByRole('button', { name: /src\/notes\.ts/ });
  await kept.click();
  await expect(again.locator('.sdiff-body')).toContainText('three');
  await expect(again).toContainText('Contents hidden: secret file');
});
