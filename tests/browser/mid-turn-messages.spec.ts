import { expect, test, type Page } from '@playwright/test';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import { resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import { longChat } from './chat-rail-kit.ts';

const LINT = '30000000-0000-4000-8000-000000000001';
const COMMENT = '30000000-0000-4000-8000-000000000002';
const REBASE = '30000000-0000-4000-8000-000000000003';

function steer(id: string, runId: string, body: string, extra: object) {
  return { id, runId, body, urgency: 'now', messageId: null, ...extra };
}

async function withSteers(page: Page, status: 'succeeded' | 'cancelled') {
  await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const detail = (await response.json()) as ConversationDetail;
    const run = detail.runs.find((candidate) => !candidate.parentRunId)!;
    const at = run.createdAt;
    const anchor = {
      textOffset: status === 'cancelled' ? 1_000_000 : 0,
      textBefore: '',
      textHeld: 0,
    };
    const memberMessages = [
      steer(LINT, run.id, 'looks like lint is failing', {
        status: 'delivered',
        createdAt: at,
        deliveredAt: at,
        ...anchor,
      }),
      steer(COMMENT, run.id, 'i see a new comment', {
        status: 'delivered',
        createdAt: at,
        deliveredAt: at,
        ...anchor,
      }),
      steer(REBASE, run.id, 'as i rebase to develop', {
        status: status === 'cancelled' ? 'missed' : 'delivered',
        createdAt: at,
        ...(status === 'cancelled' ? { deliveredAt: null } : { deliveredAt: at, ...anchor }),
      }),
    ];
    const runs = detail.runs.map((candidate) =>
      candidate.id === run.id ? { ...candidate, status } : candidate,
    );
    await route.fulfill({
      response,
      json: { ...detail, runs, memberMessages },
    });
  });
  await page.reload();
}

const groups = (page: Page) => page.locator('.msg.me.steered');

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, catalog: true });
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light' });
});

test('messages sent during a turn sit inside it, grouped, with what the agent did with them', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await longChat(page, ['Compare the queue backends in a table']);
  await withSteers(page, 'succeeded');

  const turn = page.locator('.msg.ai.solo').first();
  const taken = turn.locator('.msg.me.steered.ok');
  await expect(taken).toHaveCount(1);
  await expect(taken.locator('.steer-item')).toHaveText([
    'looks like lint is failing',
    'i see a new comment',
    'as i rebase to develop',
  ]);
  await expect(taken.getByRole('status')).toHaveText(/^Claude took this in · \S/);
  const bubble = (await taken.boundingBox())!;
  const reply = (await turn.locator('.md').first().boundingBox())!;
  expect(bubble.y).toBeLessThan(reply.y);
  await expect(page.locator(`#steer-${LINT}`)).toBeVisible();
});

test('a message the turn stopped before reading offers to send or edit it', async ({ page }) => {
  test.setTimeout(90_000);
  await longChat(page, ['Compare the queue backends in a table']);
  await withSteers(page, 'cancelled');

  const missed = groups(page).filter({ hasText: 'as i rebase to develop' });
  await expect(missed).toHaveClass(/miss/);
  await expect(missed.getByRole('status')).toHaveText('Stopped before Claude read this');
  const send = missed.getByRole('button', { name: 'Send as next message' });
  const edit = missed.getByRole('button', { name: 'Edit' });
  for (const button of [send, edit]) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(28);
  }
  await expect(groups(page).filter({ hasText: 'looks like lint' }).getByRole('status')).toHaveText(
    'Stopped before Claude answered this',
  );

  await page.route(`**/api/conversations/*/steers/${REBASE}`, (route) =>
    route.fulfill({ status: 200, json: { queue: [] } }),
  );
  await edit.click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'as i rebase to develop',
  );
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
});

test('sending a stopped message on returns focus to the message box', async ({ page }) => {
  test.setTimeout(90_000);
  await longChat(page, ['Compare the queue backends in a table']);
  await withSteers(page, 'cancelled');
  await page.route(`**/api/conversations/*/steers/${REBASE}/resend`, (route) =>
    route.fulfill({ status: 202, json: { queue: [] } }),
  );

  const missed = groups(page).filter({ hasText: 'as i rebase to develop' });
  const send = missed.getByRole('button', { name: 'Send as next message' });
  await send.focus();
  await page.keyboard.press('Tab');
  await expect(missed.getByRole('button', { name: 'Edit' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
});
