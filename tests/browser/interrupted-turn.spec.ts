import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { shoot, useSystemTheme } from './docs-seed.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.INTERRUPTED_SHOTS ?? '';
const TITLE = 'Export the report';
const UNKNOWN =
  'The worker stopped while this run was in progress, so its outcome is unknown. Nothing was retried automatically.';

async function sql<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<T>(text, values);
    return rows;
  } finally {
    await db.end();
  }
}

async function interruptedChat(): Promise<{ chatId: string; runId: string }> {
  const [chatId] = await seedChats([
    {
      title: TITLE,
      message: 'Add an export button to the report page',
      run: { status: 'outcome_unknown', error: UNKNOWN },
    },
  ]);
  const [run] = await sql<{ id: string }>(
    `UPDATE runs SET finished_at = now() WHERE conversation_id = $1 RETURNING id`,
    [chatId],
  );
  return { chatId: chatId!, runId: run!.id };
}

const card = (page: Page) => page.getByRole('group', { name: 'This turn was interrupted' });
const row = (page: Page) =>
  page.getByRole('navigation', { name: 'Chats' }).getByRole('listitem').filter({ hasText: TITLE });
const continuedRuns = (runId: string) =>
  sql<{ id: string }>('SELECT id FROM runs WHERE continues_run_id = $1', [runId]);

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  if (SHOTS) await useSystemTheme(page);
});

test('an interrupted turn offers Continue from here, which resumes in a new turn', async ({
  page,
}) => {
  const { runId } = await interruptedChat();
  await openChats(page);

  await expect(row(page).locator('.sub')).toHaveText('Interrupted: continue or start fresh');
  await expect(page.locator('.msg.ai .mood').last()).toHaveText('interrupted');
  await expect(page.locator('.error-line')).toHaveCount(0);
  await expect(card(page)).toContainText(/Spark Outpost stopped at .+ while this turn was running/);
  await expect(card(page)).toContainText('Nothing was retried.');
  const proceed = card(page).getByRole('button', { name: 'Continue from here' });
  const fresh = card(page).getByRole('button', { name: 'Start fresh' });
  await expect(fresh).toBeVisible();
  if (SHOTS) await shoot(page, SHOTS, 'interrupted-card', page.locator('.main'));

  await proceed.focus();
  await page.keyboard.press('Tab');
  await expect(fresh).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/runs/${runId}/continue`) && response.request().method() === 'POST',
  );
  await page.keyboard.press('Enter');
  expect((await sent).status()).toBe(201);

  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(`[data-turn="${runId}"]`)).toBeFocused();
  await expect(page.locator('.msg.me .bubble').last()).toHaveText('Continue from here');
  const link = page.getByRole('link', { name: 'Continued below' });
  await expect(link).toBeVisible();
  const [continued] = await continuedRuns(runId);
  await expect(link).toHaveAttribute('href', `#turn-${continued!.id}`);
  await expect(page.locator('.msg.ai').last()).toContainText('Your previous turn was interrupted', {
    timeout: 30_000,
  });
  await expect(page.locator('.msg.ai').last()).toContainText(
    'Add an export button to the report page',
  );
  await expect(page.locator('.msg.ai .mood').last()).toHaveText('done', { timeout: 60_000 });
  await expect(row(page)).not.toContainText('Interrupted');
  expect(await continuedRuns(runId)).toHaveLength(1);
});

test('a double click and a second window start one continued run', async ({ page, context }) => {
  const { runId } = await interruptedChat();
  await openChats(page);
  const other = await context.newPage();
  await other.route('**/api/events', (route) => route.abort());
  await openChats(other);
  await expect(card(other)).toBeVisible();

  await card(page).getByRole('button', { name: 'Continue from here' }).dblclick();
  await expect(card(page)).toHaveCount(0);
  const late = other.waitForResponse((response) => response.url().endsWith('/continue'));
  await card(other).getByRole('button', { name: 'Continue from here' }).click();
  expect((await late).status()).toBe(201);
  await expect(card(other)).toHaveCount(0);
  expect(await continuedRuns(runId)).toHaveLength(1);
  await expect(page.locator('.msg.me .bubble', { hasText: 'Continue from here' })).toHaveCount(1);
});

test('Start fresh dismisses the card and clears the sidebar state', async ({ page }) => {
  const { runId } = await interruptedChat();
  await openChats(page);
  const closed = page.waitForResponse((response) =>
    response.url().endsWith(`/runs/${runId}/start-fresh`),
  );
  await card(page).getByRole('button', { name: 'Start fresh' }).click();
  expect((await closed).status()).toBe(200);

  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('.ai-note')).toContainText('You started fresh');
  await expect(row(page)).not.toContainText('Interrupted');
  expect(await continuedRuns(runId)).toHaveLength(0);
  const [run] = await sql<{ interruption_choice: string }>(
    'SELECT interruption_choice FROM runs WHERE id = $1',
    [runId],
  );
  expect(run!.interruption_choice).toBe('fresh');
  if (SHOTS) await shoot(page, SHOTS, 'interrupted-started-fresh', page.locator('.main'));

  await page.reload();
  await expect(page.locator('.ai-note')).toContainText('You started fresh');
  await expect(card(page)).toHaveCount(0);
});

test('a crew turn offers only Start fresh and says why', async ({ page }) => {
  const { runId } = await interruptedChat();
  await sql(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
       role, route)
     SELECT $2, conversation_id, user_message_id, provider, 'outcome_unknown', id, 'coordinator',
       '{}'::jsonb
     FROM runs WHERE id = $1`,
    [runId, randomUUID()],
  );
  await openChats(page);

  await expect(card(page)).toContainText("Spark can't resume a crew part-way yet");
  await expect(card(page).getByRole('button', { name: 'Start fresh' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Continue from here' })).toHaveCount(0);
  if (SHOTS) await shoot(page, SHOTS, 'interrupted-crew', page.locator('.main'));
});

test('a newer message retires the card', async ({ page }) => {
  await interruptedChat();
  await openChats(page);
  await expect(card(page)).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Never mind, what time is it?');
  await input.press('Enter');

  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('.ai-note').first()).toHaveText(
    'Interrupted before finishing. Nothing was retried.',
  );
});
