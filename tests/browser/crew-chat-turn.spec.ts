import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SLOW = 30_000;

async function addSpark(page: Page): Promise<string> {
  const response = await page.request.post('/api/teammates', {
    data: { name: 'Pip', role: 'Code reviewer', instructions: 'Keep it short.' },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function saveWorkflow(page: Page, sparkId: string) {
  const workflow = {
    id: 'review-flow',
    name: 'Review flow',
    steps: [
      { id: 'first', sparkId, prompt: 'Look.', dependsOn: [], join: 'all', onFailure: 'stop' },
    ],
  };
  const response = await page.request.put('/api/workflows/review-flow', {
    data: { workflow, baseHash: null },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function chatWithOneTurn(page: Page): Promise<string> {
  const id = randomUUID();
  expect((await page.request.post('/api/conversations', { data: { id } })).status()).toBe(201);
  const sent = await page.request.post(`/api/conversations/${id}/messages`, {
    data: {
      id: randomUUID(),
      content: 'Tidy the notes',
      attachmentIds: [],
      annotations: [],
      source: 'ui',
    },
  });
  expect(sent.ok()).toBe(true);
  return id;
}

test.beforeEach(async () => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
});

test.afterEach(async ({ page }) => {
  await page.request.delete('/api/workflows/review-flow', { data: {} });
});

test('a workflow started in an ongoing chat is one folded row, not a message from you', async ({
  page,
}) => {
  await saveWorkflow(page, await addSpark(page));
  const conversationId = await chatWithOneTurn(page);
  await openChats(page);
  const turns = page.locator('section[data-turn]');
  await expect(turns).toHaveCount(1, { timeout: SLOW });
  await expect(turns.first().locator('.msg.me')).toContainText('Tidy the notes');

  const started = await page.request.post('/api/workflows/review-flow/runs', {
    data: { kind: 'run', conversationId },
  });
  expect(started.ok(), await started.text()).toBe(true);

  const row = turns.nth(1);
  const toggle = row.getByRole('button', { name: /Workflow Review flow/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: SLOW });
  await expect(row.locator('.msg.me')).toHaveCount(0);
  await expect(row.locator('.agent-block')).toHaveCount(0);
  await expect(toggle).toContainText('1 of 1 steps done', { timeout: SLOW });
  await expect(row.getByRole('button', { name: 'Open run view' })).toBeVisible();

  await toggle.click();
  await expect(row.locator('.agent-block .agent-name')).toHaveText(['Pip']);
  await expect(row.getByText('Show what Spark sent')).toBeVisible();
});
