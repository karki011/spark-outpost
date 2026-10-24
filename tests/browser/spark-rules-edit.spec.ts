import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { seedConversation, seedTurn } from '../../apps/server/test/outcome-seed.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { SPARK_RULES_FILE } from './stub-config.ts';

const rules = async (page: Page) => (await page.request.get('/api/spark-rules')).json();

function fileHash(): string {
  return createHash('sha256').update(readFileSync(SPARK_RULES_FILE, 'utf8')).digest('hex');
}

async function rulesCardChat(): Promise<void> {
  const action = {
    action: 'rules_edit',
    target: 'user',
    add: [{ effect: 'allow', rule: 'Gh(release create)' }],
    remove: [],
    fileHash: fileHash(),
    agent: 'Claude',
    modeName: 'Bypass permissions',
    provider: 'claude',
    agentMode: 'bypassPermissions',
    sessionRow: null,
  };
  const payload = {
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    truncated: false,
    sparkAction: action,
    sparkResult: { state: 'waiting', message: null, url: null },
  };
  const options = [
    { optionId: 'session', name: 'Allow for this session', kind: 'allow_always' },
    { optionId: 'confirm', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
  ];
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const conversationId = await seedConversation(db, workspaceId);
    const runId = await seedTurn(db, conversationId, {
      request: 'Let gh release create follow my mode',
      status: 'awaiting_approval',
    });
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status)
       VALUES ($1, $2, $3, 'spark_action', 'Change your Spark rules?', $4, 'hash', $5, 'pending')`,
      [randomUUID(), runId, `spark:rules_edit:${randomUUID()}`, payload, JSON.stringify(options)],
    );
  } finally {
    await db.end();
  }
}

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('the user allows an agent’s Spark rules change once on the card', async ({ page }) => {
  await page.request.put('/api/spark-rules', { data: { workflows: 'mode' } });
  await rulesCardChat();
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('button', { name: 'Outcomes', exact: true })
    .click();

  const card = page.getByRole('group', { name: /Change your Spark rules\?/ });
  await expect(card).toContainText('Claude · Bypass permissions wants to edit settings.json');
  await expect(card.getByRole('list', { name: 'Rule changes' })).toContainText(
    'allow Gh(release create)',
  );
  await expect(card).toContainText('Asks again if you switch the agent or its mode.');
  await expect(card.getByRole('button', { name: 'Allow for this session' })).toBeVisible();
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect
    .poll(async () => (await rules(page)).ghAllowed, { timeout: 15_000 })
    .toEqual(['gh release create']);
});

test('a rules file changed outside Spark waits for review in Settings', async ({ page }) => {
  await page.request.put('/api/spark-rules', { data: { workflows: 'mode' } });
  const file = JSON.parse(readFileSync(SPARK_RULES_FILE, 'utf8'));
  file.permissions.allow.push('Gh(release create)');
  writeFileSync(SPARK_RULES_FILE, JSON.stringify(file));
  expect((await rules(page)).ghAllowed).toEqual([]);

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Spark rules' })
    .click();
  const notice = page.getByRole('status').filter({ hasText: 'Rules file changed outside Spark' });
  await notice.getByRole('button', { name: 'Review' }).click();
  await expect(notice.getByRole('list', { name: 'Changes in the file' })).toContainText(
    'allow Gh(release create)',
  );
  await notice.getByRole('button', { name: 'Use the changed file' }).click();
  await expect(notice).toHaveCount(0);
  expect((await rules(page)).ghAllowed).toEqual(['gh release create']);
});
