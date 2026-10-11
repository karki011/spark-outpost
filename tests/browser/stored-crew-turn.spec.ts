import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { insertPlanDocument } from '../../apps/server/src/persistence/plan-documents.ts';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import { seedConversation, seedTask, seedTurn } from '../../apps/server/test/outcome-seed.ts';
import {
  storeHelper,
  storePieceList,
  storeReply,
} from '../../apps/server/test/stored-crew-turn.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { send, turnDone } from './project-chat-kit.ts';

const REQUEST = 'Move the date helpers into one module';
const BUILT = 'Moved the helpers into dates.ts.';
const REVIEWED = 'No concerns.';
const FINAL = 'Done: the date helpers live in dates.ts.';
const PLAN = '## Plan\n- [ ] Move the helpers\n- [ ] Update the callers';

const KEPT = {
  command: null,
  cwd: null,
  paths: [],
  diffs: [],
  truncated: false,
  checkpoint: {
    kind: 'accept',
    question: 'Keep these changes?',
    reason: 'One check still fails.',
    files: [{ path: 'src/dates.ts', change: 'modified' }],
    keptBy: 'full-auto',
    laws: ['Removed code: 40 lines in src/dates.ts'],
    lines: { added: 12, removed: 40 },
    checks: { passed: 2, failed: 1, unsettled: 0 },
  },
};

async function storeKept(db: Db, runId: string): Promise<void> {
  await db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status, decision_option_id, scope, decided_by, decided_at)
     VALUES ($1, $2, 'checkpoint:accept:1', 'accept', 'Changes kept', $3, 'hash', '[]', 'allowed',
       'keep', 'once', 'level', now())`,
    [randomUUID(), runId, JSON.stringify(KEPT)],
  );
}

async function storedCrewTurn(): Promise<void> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const conversationId = await seedConversation(db, workspaceId);
    const taskId = await seedTask(db, conversationId);
    const runId = await seedTurn(db, conversationId, { taskId, request: REQUEST, intake: true });
    const builderRunId = await storeHelper(db, runId, {
      role: 'builder',
      name: 'Bolt',
      provider: 'claude',
      model: 'sonnet',
      status: 'succeeded',
      costUsd: 0.4,
      reply: BUILT,
      route: { routedBy: 'jev', pieceKey: 'P1' },
    });
    await storeHelper(db, runId, {
      role: 'critic',
      name: 'Hawk',
      provider: 'codex',
      model: 'gpt-5',
      status: 'succeeded',
      costUsd: 0.1,
      reply: REVIEWED,
    });
    await storeReply(db, runId, FINAL);
    await storePieceList(db, {
      taskId,
      orchestrationRunId: runId,
      placementReason: 'Pieces touch different files.',
      pieces: [
        {
          key: 'P1',
          title: 'Move the helpers',
          owns: ['src/dates.ts'],
          provider: 'claude',
          model: 'sonnet',
          status: 'landed',
          builderRunId,
        },
      ],
    });
    await storeKept(db, runId);
    await insertPlanDocument(db, {
      conversationId,
      taskId,
      source: 'chat',
      body: PLAN,
      sourceRunId: runId,
      approval: { by: 'jev', option: 'build_pieces', runId, commit: null },
    });
  } finally {
    await db.end();
  }
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('a crew turn stored by an earlier version opens read-only, and the chat goes on with one agent', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await storedCrewTurn();
  await openChats(page);
  await sidebar(page).getByText('Outcomes').click();

  const stored = page.locator('.crew-turn');
  await expect(stored).toBeVisible({ timeout: 15_000 });
  await expect(stored.getByRole('button', { name: `Bolt Builder ${BUILT} $0.40` })).toBeVisible();
  await expect(stored.getByText(REVIEWED)).toBeVisible();
  await expect(stored.locator('.agent-who').filter({ hasText: 'Hawk' })).toBeVisible();
  await expect(stored.getByRole('button', { name: /^Plan saved · 2 pieces/ })).toBeVisible();
  await expect(stored.locator('.crew-foot')).toContainText('2 agents');
  await expect(stored.locator('.crew-foot')).toContainText('$0.50');
  await expect(page.getByRole('tab', { name: 'Crew' })).toBeVisible();
  await expect(stored.getByRole('button', { name: /^Message/ })).toHaveCount(0);
  await expect(page.getByText(/Steer/)).toHaveCount(0);
  await expect(page.locator('[data-piece]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^Kept · / })).toBeVisible();
  await expect(page.getByText('Worth a look')).toHaveCount(0);
  await expect(page.getByText(/check failing/)).toHaveCount(0);

  await send(page, 'What changed in that turn?');
  await turnDone(page);
  const next = page.locator('.msg.ai').last();
  await expect(next).toContainText('What changed in that turn?');
  await expect(page.locator('.crew-turn')).toHaveCount(1);
});
