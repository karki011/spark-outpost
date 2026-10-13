import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(SHOTS, `island-chat-${name}.png`),
    clip: { x: 280, y: 0, width: 720, height: 600 },
  });
}

async function openWithDesktop(page: Page, sparkFocused: boolean) {
  await page.addInitScript((sparkFocused) => {
    const none = () => () => undefined;
    const opened: string[] = [];
    Object.assign(window, {
      openedChats: opened,
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: none },
        island: {
          geometry: async () => ({
            notch: false,
            top: 24,
            notchWidth: 0,
            docked: true,
            menuBar: 24,
          }),
          onGeometry: none,
          onCommand: (callback: (action: string) => void) => {
            Object.assign(window, { islandCommand: callback });
            return () => undefined;
          },
          onEscape: none,
          sparkFocused: async () => sparkFocused,
          onSparkFocus: none,
          pickFolder: async () => null,
          pathForFile: () => null,
          setInteractive: () => undefined,
          setFocusable: () => undefined,
          drag: () => undefined,
          openChat: (id: string) => opened.push(id),
          setRestSize: () => undefined,
        },
        onOpenChat: none,
      },
    });
  }, sparkFocused);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

async function seedWaitingChat() {
  const [id] = await seedChats([
    {
      title: 'Speed up the test suite',
      message: 'Make the tests faster',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'npm test', command: 'npm test' },
    },
  ]);
  await sql(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, 'assistant', $3, now())`,
    [randomUUID(), id, 'I found **two** slow suites:\n- `api.test.ts`\n- `ui.test.ts`'],
  );
  return id!;
}

test('Sessions lists every active chat and opens one inline to read, approve and reply', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats(
    Array.from({ length: 9 }, (_, index) => ({
      title: `Recent chat ${index + 1}`,
      run: { status: 'succeeded' },
      minutesAgo: index + 1,
    })),
  );
  const chatId = await seedWaitingChat();
  await openWithDesktop(page, true);
  await page.evaluate(() =>
    (window as unknown as { islandCommand: (action: string) => void }).islandCommand('sessions'),
  );
  const list = island(page).getByRole('listbox', { name: 'Recent sessions' });
  await expect(list.getByRole('option')).toHaveCount(10);
  await expect(list.getByRole('group', { name: 'Needs you' })).toContainText(
    'Speed up the test suite',
  );
  await shot(page, 'list');

  await list.getByRole('option', { name: /Speed up the test suite/ }).click();
  const log = island(page).getByRole('log', { name: 'Recent messages' });
  await expect(log).toContainText('Make the tests faster');
  await expect(log.locator('strong')).toHaveText('two');
  await expect(log.locator('li')).toHaveCount(2);
  const waiting = island(page).getByRole('group', { name: 'Waiting for you' });
  await expect(waiting).toContainText('npm test');
  await shot(page, 'inline');
  const frame = (await island(page).boundingBox())!;
  expect(frame.y).toBe(0);
  expect(frame.width).toBeGreaterThan(640);

  await waiting.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect
    .poll(async () => (await sql(`SELECT status FROM approvals`)).rows[0]?.status)
    .toBe('allowed');

  const reply = island(page).getByRole('textbox', { name: 'Reply to Speed up the test suite' });
  await expect(reply).toHaveAttribute('placeholder', 'Queue a reply for when this turn ends…');
  const mac = await page.evaluate(() => navigator.platform.startsWith('Mac'));
  await expect(island(page).locator('.isl-qc-hint')).toHaveText(
    `Enter to queue · ${mac ? '⌘Enter' : 'Ctrl+Enter'} to send now`,
  );
  await reply.fill('Thanks, carry on');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () =>
      (await sql(`SELECT content FROM chat_queue WHERE conversation_id = $1`, [chatId])).rows.map(
        (row) => row.content,
      ),
    )
    .toEqual(['Thanks, carry on']);
  await expect(island(page).locator('.isl-qc-hint')).toHaveText(
    '1 queued · sends when this turn ends',
  );

  await reply.fill('Read this first');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(async () =>
      (
        await sql(`SELECT body, urgency FROM member_messages WHERE conversation_id = $1`, [chatId])
      ).rows.map((row) => `${row.urgency}: ${row.body}`),
    )
    .toEqual(['now: Read this first']);
  await expect(reply).toHaveValue('');
  await expect(island(page).locator('.isl-qc-hint')).toHaveText(
    '1 queued · sends when this turn ends',
  );

  await island(page).getByRole('button', { name: 'Open in Spark' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { openedChats: string[] }).openedChats),
  ).toEqual([chatId]);
});

test('when Spark is in the background a waiting blob opens its chat', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openWithDesktop(page, false);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await seedWaitingChat();
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  const blob = page.getByRole('button', { name: /Chat: Speed up the test suite/ });
  await expect(blob).toBeVisible();
  await page.waitForTimeout(500);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(island(page).locator('.isl-restline')).toContainText('Review');
  await shot(page, 'waiting-line');
  await blob.click();
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  const waiting = island(page).getByRole('group', { name: 'Waiting for you' });
  await expect(waiting).toBeFocused();
  await expect(waiting.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
  await shot(page, 'waiting-opened');
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});
