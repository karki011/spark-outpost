import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import { recommendedRulesText } from '../../apps/server/src/spark-rules/recommended.ts';
import { seedConversation, seedTurn } from '../../apps/server/test/outcome-seed.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { SPARK_RULES_FILE } from './stub-config.ts';

const WORKFLOW = 'gh workflow run cd-alfa.yml';
const RELEASE = 'gh release create v1.2.0';

interface Refused {
  command: string;
  group: 'workflows' | 'other';
  prefix: string;
}

async function storeRefused(db: Db, runId: string, refused: Refused): Promise<void> {
  const payload = {
    command: refused.command,
    cwd: null,
    paths: [],
    diffs: [],
    truncated: false,
    sparkRule: { group: refused.group, prefix: refused.prefix },
  };
  await db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status, reason, decision_option_id, scope, decided_by, decided_at)
     VALUES ($1, $2, $3, 'execute', $4, $5, 'hash', $6, 'denied', 'Spark rules', 'reject', 'once',
       'policy', now())`,
    [
      randomUUID(),
      runId,
      randomUUID(),
      refused.command,
      JSON.stringify(payload),
      JSON.stringify([{ optionId: 'reject', name: 'Deny', kind: 'reject_once' }]),
    ],
  );
}

async function refusedChat(refused: readonly Refused[]): Promise<void> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    writeFileSync(SPARK_RULES_FILE, recommendedRulesText({ workflows: 'refused', ghAllowed: [] }));
    const conversationId = await seedConversation(db, workspaceId);
    const runId = await seedTurn(db, conversationId, { request: 'Deploy alfa' });
    for (const card of refused) await storeRefused(db, runId, card);
  } finally {
    await db.end();
  }
}

const rules = async (page: Page) => (await page.request.get('/api/spark-rules')).json();
const card = (page: Page, command: string) =>
  page.getByRole('group').filter({ has: page.locator('code', { hasText: command }) });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('a refused workflow card allows workflows and retries', async ({ page }) => {
  await refusedChat([{ command: WORKFLOW, group: 'workflows', prefix: 'gh workflow run' }]);
  await openChats(page);
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Outcomes').click();

  const refused = card(page, WORKFLOW);
  await expect(refused).toContainText('running workflows is off in Spark rules');
  await expect(refused.getByRole('button', { name: 'Allow once' })).toBeVisible();
  await expect(refused.getByRole('button', { name: 'Keep refused' })).toBeVisible();
  await refused.getByRole('button', { name: 'Allow workflows and retry' }).click();
  await expect(refused.getByRole('status')).toHaveText(
    'Workflows now follow the agent’s mode. The agent runs it again.',
  );
  expect(await rules(page)).toMatchObject({ workflows: 'mode' });
  await expect(page.getByText(/Spark rules now allow the command Spark refused/)).toBeVisible();
});

test('Allow once and Keep refused answer each card once and leave the settings alone', async ({
  page,
}) => {
  await refusedChat([
    { command: RELEASE, group: 'other', prefix: 'gh release create' },
    { command: 'gh pr close 12', group: 'other', prefix: 'gh pr close' },
  ]);
  await openChats(page);
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Outcomes').click();

  const release = card(page, RELEASE);
  await expect(release).toContainText("gh release create isn't an allowed command in Spark rules");
  await expect(
    release.getByRole('button', { name: 'Allow gh release create and retry' }),
  ).toBeVisible();
  await release.getByRole('button', { name: 'Allow once' }).click();
  await expect(release.getByRole('status')).toHaveText('Allowed once. The agent runs it again.');

  const close = card(page, 'gh pr close 12');
  await close.getByRole('button', { name: 'Keep refused' }).click();
  await expect(close.getByRole('status')).toHaveText('Kept refused.');

  expect(await rules(page)).toMatchObject({ workflows: 'refused', ghAllowed: [] });
  await page.reload();
  await expect(card(page, RELEASE).getByRole('status')).toHaveText(
    'Allowed once. The agent runs it again.',
  );
  await expect(card(page, 'gh pr close 12').getByRole('button')).toHaveCount(0);
});
