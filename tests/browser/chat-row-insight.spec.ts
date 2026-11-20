import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const MINUTE = 60_000;

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return (await db.query(text, values)).rows as Record<string, unknown>[];
  } finally {
    await db.end();
  }
}

async function runOf(chatId: string): Promise<string> {
  const [row] = await sql('SELECT id FROM runs WHERE conversation_id = $1', [chatId]);
  return row!.id as string;
}

async function planned(chatId: string, entries: { content: string; status: string }[]) {
  const runId = await runOf(chatId);
  const taskId = randomUUID();
  await sql('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
    taskId,
    chatId,
    'Plan',
  ]);
  await sql('UPDATE runs SET task_id = $2 WHERE id = $1', [runId, taskId]);
  await sql(
    `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
     VALUES ($1, 'plan', 1, $2, $3)`,
    [
      taskId,
      JSON.stringify({ entries: entries.map((e) => ({ ...e, priority: 'medium' })) }),
      runId,
    ],
  );
}

async function event(runId: string, payload: Record<string, unknown>) {
  await sql(
    `INSERT INTO run_events (run_id, seq, type, payload)
     VALUES ($1, (SELECT COALESCE(max(seq), 0) + 1 FROM run_events WHERE run_id = $1), $2, $3)`,
    [runId, payload.type, JSON.stringify(payload)],
  );
}

async function toolCall(runId: string, stepName: string, toolName: string, at: number, ms: number) {
  const metadata = { spark: { toolName } };
  await event(runId, { type: 'STEP_STARTED', stepName, timestamp: at, metadata });
  await event(runId, { type: 'STEP_FINISHED', stepName, timestamp: at + ms, metadata });
}

const rowLine = (page: Page, chatId: string) =>
  page.locator(`.row[data-chat="${chatId}"] .row-line`);

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('chat rows say what the agent is doing, how long a chat waits and when a turn finished', async ({
  page,
}) => {
  const [working, waiting, finished, idle] = await seedChats([
    { title: 'Working chat', run: { status: 'running' } },
    {
      title: 'Waiting chat',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Run tests', command: 'pnpm test' },
    },
    { title: 'Finished chat', run: { status: 'succeeded' }, unread: true },
    { title: 'Quiet chat', run: { status: 'succeeded' } },
  ]);
  await planned(working!, [
    { content: 'Read the row code', status: 'completed' },
    { content: 'Wire the plan step into the row', status: 'in_progress' },
  ]);
  await page.clock.install({ time: Date.now() });
  await openChats(page);

  await expect(rowLine(page, working!)).toHaveText('Wire the plan step into the row');
  await expect(rowLine(page, waiting!)).toHaveText('Waiting under a minute');
  await expect(rowLine(page, finished!)).toHaveText(/^Finished \d{1,2}:\d{2}( [AP]M)?$/);
  await expect(rowLine(page, idle!)).toHaveCount(0);

  const list = page.locator('.row[data-chat]').first();
  await list.locator('.row-open').focus();
  await page.clock.fastForward(3 * MINUTE);
  await expect(rowLine(page, waiting!)).toHaveText('Waiting 3m');
  await expect(list.locator('.row-open')).toBeFocused();
});

test('picking another model with a warm cache says what the next message re-sends, and can be dismissed', async ({
  page,
}) => {
  const [chatId] = await seedChats([{ title: 'Switch chat', run: { status: 'succeeded' } }]);
  const runId = await runOf(chatId!);
  await sql(
    `UPDATE runs SET provider = 'claude', model = 'claude-opus-5-5', used_model = 'claude-opus-5-5',
       finished_at = now() WHERE id = $1`,
    [runId],
  );
  await sql(
    `INSERT INTO run_prompt_cache (run_id, first_key, first_write, last_key, last_context, last_at,
       model, ttl_seconds)
     VALUES ($1, 'a', 2000, 'b', 182000, now() - interval '1 minute', 'claude-opus-5-5', 300)`,
    [runId],
  );
  await sql(
    `UPDATE conversations SET provider = 'claude',
       overrides = '{"claude":{"model":"claude-opus-5-5"}}' WHERE id = $1`,
    [chatId],
  );
  await openChats(page);
  await page.locator(`.row[data-chat="${chatId}"] .row-open`).click();
  await expect(page.locator('.chat-title')).toHaveText('Switch chat');
  const note = page.locator('.switch-note');
  await expect(note).toHaveCount(0);

  await sql(
    `UPDATE conversations SET overrides = '{"claude":{"model":"claude-sonnet-5-5"}}' WHERE id = $1`,
    [chatId],
  );
  await page.reload();
  await expect(note).toHaveText(/^Next message re-sends ~182K tokens uncached \(≈\$\d+\.\d+\)$/);
  await expect(note).toHaveAttribute('role', 'status');

  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Carry on');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await note.getByRole('button', { name: 'Dismiss cache note' }).click();
  await expect(note).toHaveCount(0);
  await expect(input).toHaveValue('Carry on');
});

test('the Cost tab counts calls and time by tool, MCP server and skill', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 20_000 });

  const [run] = await sql(
    `SELECT id FROM runs WHERE parent_run_id IS NULL ORDER BY created_at DESC LIMIT 1`,
  );
  const runId = run!.id as string;
  const at = Date.now() - 10 * MINUTE;
  await toolCall(runId, 'Reading jira', 'mcp__spark__spark_jira', at, 3_000);
  await toolCall(runId, 'Running a command', 'Bash', at + 5_000, 4_000);
  await toolCall(runId, 'Running a command', 'Bash', at + 10_000, 2_000);
  await event(runId, {
    type: 'STEP_STARTED',
    stepName: 'Using a skill',
    timestamp: at + 20_000,
    metadata: { spark: { toolName: 'Skill', target: '{"skill":"release-notes"}' } },
  });
  await page.reload();

  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await panel.getByRole('tab', { name: 'Cost' }).click();
  const tools = panel.getByRole('list', { name: 'By tool' }).getByRole('listitem');
  await expect(tools.first()).toContainText('2 calls · 6s');
  await expect(panel.getByRole('list', { name: 'By MCP server' })).toHaveText(
    /Spark\s*1 call · 3s/,
  );
  await expect(panel.getByRole('list', { name: 'By skill' })).toHaveText(/release-notes\s*1 call/);
  await expect(panel.locator('.cost-tools')).toContainText('don’t report cost per tool');
});
