import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import {
  fakeHomeDesktop,
  island,
  nowCard,
  openHome,
  openIsland,
  SHOTS,
} from './island-home-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const LONG_TITLE = "So the branch we're working off of is…";

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function snap(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  const box = (await island(page).boundingBox())!;
  await page.screenshot({
    path: path.join(SHOTS, `island-home-${name}.png`),
    clip: { x: box.x - 12, y: 0, width: box.width + 24, height: box.y + box.height + 16 },
  });
}

async function makeTerminal(conversationId: string, state: string) {
  await sql(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [conversationId]);
  await sql(
    `INSERT INTO native_terminal_sessions (id, conversation_id, provider, state, cwd, label)
     VALUES ($1, $2, 'claude', $3, '/Users/ada/code/orders-web-app', 'my files · orders-web-app')`,
    [randomUUID(), conversationId, state],
  );
}

async function addReply(conversationId: string, content: string) {
  await sql(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     SELECT $1, $2, 'assistant', $3, id FROM runs WHERE conversation_id = $2`,
    [randomUUID(), conversationId, content],
  );
}

async function addStep(conversationId: string, name: string, finished: boolean) {
  for (const type of finished ? ['STEP_STARTED', 'STEP_FINISHED'] : ['STEP_STARTED']) {
    await sql(
      `INSERT INTO run_events (run_id, seq, type, payload)
       SELECT id, (SELECT COALESCE(max(seq), 0) + 1 FROM run_events WHERE run_id = runs.id), $2, $3
       FROM runs WHERE conversation_id = $1`,
      [conversationId, type, JSON.stringify({ type, stepName: name })],
    );
  }
}

async function addProject(page: Page): Promise<string> {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'island-home-')), 'orders-web-app');
  mkdirSync(root);
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

async function open(page: Page, theme = 'graphite') {
  await fakeHomeDesktop(page, theme);
  await openIsland(page);
  await openHome(page);
}

const facts = (page: Page) => nowCard(page).locator('.isl-now-facts');

for (const theme of ['graphite', 'apricot']) {
  test(`a quiet chat shows its last reply, project and age, and Reply opens the reply box (${theme})`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    const projectId = await addProject(page);
    const [chat] = await seedChats([
      { title: LONG_TITLE, run: { status: 'cancelled' }, projectIds: [projectId], minutesAgo: 125 },
    ]);
    await addReply(
      chat!,
      'The branch is `feature/web-apps`, two commits ahead of main. Tests pass.',
    );
    await open(page, theme);

    const title = nowCard(page).locator('.isl-now-title');
    await expect(title).toHaveAttribute('title', LONG_TITLE);
    expect(
      await title.evaluate((node) => {
        node.scrollLeft = 60;
        return [
          node.scrollLeft,
          getComputedStyle(node).textOverflow,
          getComputedStyle(node).direction,
        ];
      }),
    ).toEqual([0, 'ellipsis', 'ltr']);
    await expect(nowCard(page).locator('.isl-now-said')).toHaveText(
      'Last reply: The branch is feature/web-apps, two commits ahead of main.',
    );
    await expect(facts(page)).toContainText('orders-web-app');
    await expect(facts(page).locator('time')).toHaveText('2 h ago');
    await expect(nowCard(page).getByRole('button', { name: `Open ${LONG_TITLE}` })).toHaveText(
      'Open',
    );
    await snap(page, `idle-chat-${theme === 'graphite' ? 'dark' : 'light'}`);

    await nowCard(page)
      .getByRole('button', { name: `Reply to ${LONG_TITLE}` })
      .click();
    await expect(
      island(page).getByRole('textbox', { name: `Reply to ${LONG_TITLE}` }),
    ).toBeFocused();
  });
}

test('a Terminal session is labelled in words with its folder, and has no Reply', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [chat] = await seedChats([{ title: LONG_TITLE, minutesAgo: 40 }]);
  await makeTerminal(chat!, 'ready');
  await open(page);
  await expect(nowCard(page).locator('.isl-now-note')).toHaveText('Terminal sessionIdle');
  await expect(facts(page).locator('.isl-now-fact')).toHaveText(
    /^Claude · (\S.* · )?orders-web-app$/,
  );
  await expect(facts(page).locator('time')).toHaveText('just now');
  await expect(nowCard(page).locator('.isl-now-chip svg')).toHaveCount(0);
  await expect(island(page)).not.toContainText('>_');
  await expect(nowCard(page).getByRole('button', { name: /^Reply/ })).toHaveCount(0);
  await expect(nowCard(page).getByRole('button', { name: /^Open/ })).toBeVisible();
  await snap(page, 'idle-terminal');
});

test('working keeps its steps, waiting says what it waits for, and two sessions show a pager', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [billing] = await seedChats([
    { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 },
  ]);
  await addStep(billing!, 'Read `src/billing.ts`', true);
  await addStep(billing!, 'Edit `src/billing.ts`', false);
  await open(page);
  await expect(nowCard(page).getByRole('list', { name: 'Latest steps' })).toContainText('Editing');
  await expect(facts(page)).toHaveCount(0);
  const height = () => nowCard(page).evaluate((card) => (card as HTMLElement).offsetHeight);
  const working = await height();
  await snap(page, 'working');

  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
      minutesAgo: 0,
    },
  ]);
  await expect(nowCard(page)).toHaveAccessibleName('Now: Deploy the site');
  await expect(nowCard(page).locator('.isl-now-note[data-tone="wait"]')).toHaveText(
    /^Waiting: .*pnpm deploy$/,
  );
  const pager = nowCard(page).getByRole('group', { name: 'Live chats, 1 of 2' });
  await expect(pager).toContainText('1 of 2');
  expect(await height()).toBe(working);
  await snap(page, 'waiting-two-sessions');

  await pager.getByRole('button', { name: 'Show Fix billing totals' }).click();
  await expect(nowCard(page).getByRole('group', { name: 'Live chats, 2 of 2' })).toBeVisible();
  expect(await height()).toBe(working);
});

test('Needs you lists what is waiting and opens it, after the Now card in focus order', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const projectId = await addProject(page);
  const [done] = await seedChats([
    { title: 'Tidy the README', run: { status: 'succeeded' }, projectIds: [projectId] },
  ]);
  await addReply(done!, 'README is tidy: headings fixed and the install steps reordered.');
  await open(page);
  await expect(island(page).getByRole('region', { name: 'Quick start' })).toHaveCount(0);
  const needs = island(page).getByRole('region', { name: 'Needs you' });
  await expect(nowCard(page).locator('.isl-now-said')).toContainText('README is tidy');
  await snap(page, 'done-needs-you-small');

  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
    },
  ]);
  const waiting = needs.getByRole('button', { name: 'Approve: run pnpm deploy' });
  await expect(waiting).toBeVisible();
  await expect(needs.getByRole('button').first()).toHaveText('Approve: run pnpm deploy');
  await nowCard(page)
    .getByRole('button', { name: /^Reply|^Approve|^Open/ })
    .last()
    .focus();
  for (let step = 0; step < 6; step += 1) {
    if (await waiting.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(waiting).toBeFocused();
  await snap(page, 'needs-you-small');
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('tab', { name: /^Chats/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test.describe('on a wide screen', () => {
  test.use({ viewport: { width: 1920, height: 720 } });

  test('the widest panel keeps both cards filled', async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    const projectId = await addProject(page);
    const [done] = await seedChats([
      { title: 'Tidy the README', run: { status: 'succeeded' }, projectIds: [projectId] },
    ]);
    await addReply(done!, 'README is tidy: headings fixed and the install steps reordered.');
    await fakeHomeDesktop(page);
    await page.goto('/island');
    await page.mouse.move(960, 600);
    await island(page)
      .getByRole('button', { name: /Open Spark Island/ })
      .click();
    await expect(nowCard(page).locator('.isl-now-said')).toContainText('README is tidy');
    await expect.poll(async () => (await island(page).boundingBox())!.width).toBeGreaterThan(900);
    const cards = await island(page)
      .locator('.isl-hcard')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).offsetHeight));
    expect(cards[0]).toBe(cards[1]);
    await snap(page, 'done-large');
  });
});
