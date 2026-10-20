import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });
const log = (page: Page) => island(page).locator('.isl-ask-log');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(SHOTS, `island-ask-history-${name}.png`),
    clip: { x: 300, y: 0, width: 680, height: 560 },
  });
}

async function assistantId(page: Page): Promise<string> {
  const response = await page.request.post('/api/spark-assistant', { data: {} });
  return ((await response.json()) as { conversationId: string }).conversationId;
}

async function seedAsked(conversationId: string, questions: readonly string[], from: Date) {
  const db = openTestDb();
  try {
    for (const [index, question] of questions.entries()) {
      const askedAt = new Date(from.getTime() + index * 60_000);
      const messageId = randomUUID();
      const runId = randomUUID();
      await db.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, 'user', $3, $4)`,
        [messageId, conversationId, question, askedAt],
      );
      await db.query(
        `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, created_at)
         VALUES ($1, $2, $3, 'claude', 'succeeded', $4)`,
        [runId, conversationId, messageId, askedAt],
      );
      await db.query(
        `INSERT INTO messages (id, conversation_id, role, content, run_id, created_at)
         VALUES ($1, $2, 'assistant', $3, $4, $5)`,
        [
          randomUUID(),
          conversationId,
          `Answer to ${question}`,
          runId,
          new Date(askedAt.getTime() + 1_000),
        ],
      );
    }
  } finally {
    await db.end();
  }
}

async function openAsk(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
  await page.keyboard.press('Alt+Shift+Space');
  await page.keyboard.press('Meta+3');
  const ask = island(page).getByRole('textbox', { name: 'Ask Spark' });
  await expect(ask).toBeFocused();
  return ask;
}

test('Ask Spark keeps its history, starts a new topic and links answers to cards and chats', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
    { title: 'pipeline-poc', run: { status: 'succeeded' } },
  ]);
  const ask = await openAsk(page);
  await expect(ask).toHaveAttribute(
    'placeholder',
    'Ask about your chats, tickets, spend, calendar…',
  );
  const chips = island(page).getByRole('group', { name: 'Suggested questions' });
  await expect(chips.getByRole('button')).toHaveText(['Who needs me?', 'What’s running?']);

  await ask.fill('What did pipeline-poc change?');
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('button', { name: 'Open “pipeline-poc”' })).toBeVisible({
    timeout: 20_000,
  });

  await island(page).getByRole('button', { name: 'New topic' }).click();
  const divider = island(page).getByRole('separator', { name: 'New topic · today' });
  await expect(divider).toBeVisible();
  await expect(ask).toBeFocused();

  await chips.getByRole('button', { name: 'Who needs me?' }).click();
  await expect(log(page)).toContainText('1 chat needs you: “Deploy the site”.');
  await expect(log(page).getByText('Live · answered instantly')).toBeVisible();
  await expect(log(page).locator('.isl-ask-q, [role="separator"]')).toHaveText([
    'What did pipeline-poc change?',
    'New topic · today',
    'Who needs me?',
  ]);
  await shot(page, 'topic');

  await log(page).getByRole('button', { name: 'Review “Deploy the site”' }).click();
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await expect(island(page)).toContainText('pnpm deploy');

  await page.reload();
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.keyboard.press('Alt+Shift+Space');
  await page.keyboard.press('Meta+3');
  await expect(log(page).locator('.isl-ask-q')).toHaveText(['What did pipeline-poc change?']);
  await expect(divider).toBeVisible();
});

test('Ask Spark loads older questions as you scroll up and keeps your place', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const id = await assistantId(page);
  const questions = Array.from({ length: 25 }, (_, index) => `Question ${index + 1}`);
  await seedAsked(id, questions, new Date(Date.now() - 2 * 24 * 60 * 60_000));
  await openAsk(page);

  const asked = log(page).locator('.isl-ask-q');
  await expect(asked).toHaveCount(20);
  await expect(asked.last()).toHaveText('Question 25');
  await expect(asked.last()).toBeInViewport();
  await expect(log(page).getByRole('button', { name: 'Earlier questions' })).toBeAttached();

  const fromBottom = await log(page).evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
    return element.scrollHeight;
  });
  await expect(asked).toHaveCount(25);
  await expect(asked.first()).toHaveText('Question 1');
  await expect(log(page).getByRole('button', { name: 'Earlier questions' })).toHaveCount(0);
  await expect(log(page).locator('.isl-ask-day').first()).toBeAttached();
  const kept = await log(page).evaluate((element) => element.scrollHeight - element.scrollTop);
  expect(Math.abs(kept - fromBottom)).toBeLessThan(60);
  await expect(log(page).getByText('Question 6', { exact: true })).toBeInViewport();
});

test('the full Ask Spark conversation shows the New topic divider', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  const id = await assistantId(page);
  await seedAsked(id, ['Before the topic'], new Date(Date.now() - 10 * 60_000));
  expect((await page.request.post('/api/spark-assistant/topic', { data: {} })).ok()).toBe(true);
  await seedAsked(id, ['After the topic'], new Date(Date.now() + 1_000));

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: /Spark assistant/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Spark assistant' })
    .getByRole('button', { name: 'View conversation' })
    .click();
  const thread = page.locator('.thread');
  await expect(thread.getByRole('separator', { name: 'New topic · today' })).toBeVisible();
  await expect(thread.locator('.msg.me .bubble, [role="separator"]')).toHaveText([
    'Before the topic',
    'New topic · today',
    'After the topic',
  ]);
});

test('the full conversation shows a New topic divider before any question', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await assistantId(page);
  expect((await page.request.post('/api/spark-assistant/topic', { data: {} })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: /Spark assistant/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Spark assistant' })
    .getByRole('button', { name: 'View conversation' })
    .click();
  await expect(
    page.locator('.thread').getByRole('separator', { name: 'New topic · today' }),
  ).toBeVisible();
});
