import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openSparksPage } from './crew-files-kit.ts';
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

test('a workflow run is one line in the thread and a card above the message box', async ({
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

  const turn = turns.nth(1);
  const line = turn.locator('.wfc-line');
  await expect(line).toContainText('Review flow', { timeout: SLOW });
  await expect(line).toContainText('Done', { timeout: SLOW });
  await expect(turn.locator('.msg.me')).toHaveCount(0);
  await expect(turn.locator('.agent-block')).toHaveCount(0);
  await expect(turn.getByText('Show what Spark sent')).toBeVisible();

  const card = page.getByRole('region', { name: 'Workflow runs' });
  const entry = card.getByRole('group', { name: 'Workflow Review flow' });
  await expect(entry).toContainText('Done');
  await line.getByRole('button', { name: /^Show Review flow/ }).click();
  const toggle = entry.getByRole('button', { name: 'Workflow Review flow details' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(entry.getByRole('list', { name: 'Steps' })).toContainText('Pip');
  await expect(entry.getByRole('button', { name: 'Open run view' })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  await entry.getByRole('button', { name: 'Dismiss Workflow Review flow' }).click();
  await expect(card).toHaveCount(0);
  await expect(line.getByRole('button', { name: 'Open run view' })).toBeVisible();
});

test('Run in chats… starts the same workflow in two chats at once', async ({ page }) => {
  await saveWorkflow(page, await addSpark(page));
  const first = await chatWithOneTurn(page);
  const second = await chatWithOneTurn(page);
  await openSparksPage(page);
  await page.getByRole('tab', { name: /^Workflows/ }).click();
  await page.getByRole('button', { name: 'Run in chats: Review flow' }).click();

  const dialog = page.getByRole('dialog', { name: 'Run Review flow in chats' });
  await expect(dialog.getByRole('checkbox')).toHaveCount(2, { timeout: SLOW });
  await dialog.getByRole('checkbox').nth(0).check();
  await dialog.getByRole('checkbox').nth(1).check();
  await dialog.getByRole('button', { name: 'Run in 2 chats' }).click();
  await expect(dialog).toHaveCount(0, { timeout: SLOW });

  await expect
    .poll(async () => {
      const response = await page.request.get('/api/workflows/review-flow/runs');
      const { runs } = (await response.json()) as { runs: { conversationId: string }[] };
      return runs.map((run) => run.conversationId).toSorted();
    })
    .toEqual([first, second].toSorted());
});
