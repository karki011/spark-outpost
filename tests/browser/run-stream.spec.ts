import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import { isCancelRequested } from '../../apps/server/src/persistence/run-events.ts';
import { getRun } from '../../apps/server/src/persistence/runs.ts';
import { seedConversation, seedTask, seedTurn } from '../../apps/server/test/outcome-seed.ts';
import { storeHelper } from '../../apps/server/test/stored-crew-turn.ts';
import { restartApi } from './api-restart.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const HELPERS = 5;

let db: Db;

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  db = openTestDb();
});

test.afterEach(async () => {
  await db.end();
});

async function liveCrew(): Promise<string[]> {
  const workspaceId = await ensureLocalWorkspace(db);
  const conversationId = await seedConversation(db, workspaceId);
  const taskId = await seedTask(db, conversationId);
  const parent = await seedTurn(db, conversationId, {
    taskId,
    request: 'Build it',
    intake: true,
    status: 'running',
  });
  const helpers: string[] = [];
  for (let index = 0; index < HELPERS; index++) {
    helpers.push(
      await storeHelper(db, parent, {
        role: 'builder',
        name: `Bolt${index}`,
        provider: 'claude',
        model: 'sonnet',
        status: 'running',
        costUsd: 0.1,
        reply: null,
      }),
    );
  }
  return helpers;
}

async function append(runId: string, ...events: object[]): Promise<void> {
  await db.query(
    `INSERT INTO run_events (run_id, seq, type, payload)
     SELECT $1, COALESCE((SELECT MAX(seq) FROM run_events WHERE run_id = $1), 0) + listed.position,
       listed.type, listed.payload::jsonb
     FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS listed(type, payload, position)`,
    [
      runId,
      events.map((event) => (event as { type: string }).type),
      events.map((event) => JSON.stringify(event)),
    ],
  );
  await db.query(`SELECT pg_notify('run_events', $1)`, [runId]);
}

const text = (runId: string, delta: string) => [
  { type: 'TEXT_MESSAGE_START', messageId: `m-${runId}`, role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${runId}`, delta },
];

const more = (runId: string, delta: string) => ({
  type: 'TEXT_MESSAGE_CONTENT',
  messageId: `m-${runId}`,
  delta,
});

function runStreams(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/api/run-events')) urls.push(request.url());
  });
  return urls;
}

async function openCrew(page: Page): Promise<void> {
  await openChats(page);
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Outcomes').click();
  await expect(page.locator('.crew-turn')).toBeVisible({ timeout: 15_000 });
}

test('one connection carries every live run, plain requests still get through, and a step refetches nothing @packaged', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const helpers = await liveCrew();
  const streams = runStreams(page);
  await openCrew(page);
  for (const [index, runId] of helpers.entries()) {
    await append(runId, ...text(runId, `reply-from-${index}`));
  }
  for (let index = 0; index < HELPERS; index++) {
    await expect(page.getByText(`reply-from-${index}`).first()).toBeVisible({ timeout: 15_000 });
  }
  expect(streams).toHaveLength(1);
  for (const runId of helpers) expect(decodeURIComponent(streams[0]!)).toContain(runId);

  let refetches = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/(conversations(\/[0-9a-f-]{36})?|attention)$/.test(path)) refetches++;
  });
  await append(helpers[0]!, { type: 'STEP_STARTED', stepName: 'Reading the code' });
  await append(helpers[0]!, { type: 'STEP_FINISHED', stepName: 'Reading the code' });
  await page.waitForTimeout(2_500);
  expect(refetches).toBe(0);

  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('#terminal-dock .term-light.open')).toBeVisible({ timeout: 10_000 });
});

test('after the server drops, the stream catches up with no repeats, and a run finished meanwhile ends @packaged', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const helpers = await liveCrew();
  const [finishing, running] = helpers as [string, string];
  const streams = runStreams(page);
  await openCrew(page);
  await append(finishing, ...text(finishing, 'before-the-drop-a'));
  await append(running, ...text(running, 'before-the-drop-b'));
  await expect(page.getByText('before-the-drop-a').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('before-the-drop-b').first()).toBeVisible();

  const restarted = restartApi(request);
  await append(finishing, more(finishing, ' after-the-drop-a'), {
    type: 'RUN_FINISHED',
    threadId: 'thread',
    runId: finishing,
  });
  await db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
    finishing,
  ]);
  await append(running, more(running, ' after-the-drop-b'));
  await restarted;

  await expect(page.getByRole('button', { name: /^Bolt0 Builder done/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('before-the-drop-b after-the-drop-b', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(streams.length).toBeGreaterThan(1);
  await expect.poll(() => decodeURIComponent(streams.at(-1)!).includes(`${running}:`)).toBe(true);

  expect(await isCancelRequested(db, running)).toBe(false);
  expect((await getRun(db, running))?.status).toBe('running');
});
