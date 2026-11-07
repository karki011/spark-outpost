import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { seedConversation, seedTurn } from '../../apps/server/test/outcome-seed.ts';
import { browseTo } from './add-folder-kit.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { CLONE_TEST_ROOT } from './stub-config.ts';

let base = '';

test.beforeEach(async ({ page }) => {
  mkdirSync(CLONE_TEST_ROOT, { recursive: true });
  base = realpathSync(mkdtempSync(path.join(CLONE_TEST_ROOT, 'repos-folders-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function linkCardChat(): Promise<void> {
  const action = {
    action: 'link_repo',
    repo: 'feature-identity',
    path: path.join(base, 'feature-identity'),
    displayPath: '~/code/feature-identity',
    origin: 'acme/identity',
    projectId: null,
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
    { optionId: 'confirm', name: 'Link', kind: 'allow_once' },
    { optionId: 'decline', name: 'Don’t', kind: 'reject_once' },
  ];
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const conversationId = await seedConversation(db, workspaceId);
    const runId = await seedTurn(db, conversationId, {
      request: 'Check the identity repo',
      status: 'awaiting_approval',
    });
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status)
       VALUES ($1, $2, $3, 'spark_action', 'Link feature-identity to this chat?', $4, 'hash', $5,
         'pending')`,
      [randomUUID(), runId, `spark:link_repo:${randomUUID()}`, payload, JSON.stringify(options)],
    );
  } finally {
    await db.end();
  }
}

test('Settings → Projects adds and removes a repos folder', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Projects' })
    .click();
  await expect(page.getByText('None yet. Add the folder where you keep your repos.')).toBeVisible();
  const add = page.getByRole('button', { name: 'Add repos folder…' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Choose a repos folder' });
  await browseTo(dialog, base);
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  await expect(dialog).toHaveCount(0);
  const list = page.getByRole('list', { name: 'Repos folders' });
  const shown = path.basename(base);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText(shown);
  await list.getByRole('button', { name: /^Remove / }).click();
  await expect(list).toHaveCount(0);
  await expect(page.getByText('None yet. Add the folder where you keep your repos.')).toBeVisible();
});

test('an agent’s request to link a repo shows the folder, origin and Link', async ({ page }) => {
  await linkCardChat();
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('button', { name: 'Outcomes', exact: true })
    .click();
  const card = page.getByRole('group', { name: /Link feature-identity to this chat\?/ });
  await expect(card).toContainText('~/code/feature-identity');
  await expect(card).toContainText('acme/identity');
  await expect(card).toContainText('Spark adds it as a project');
  await expect(card).toContainText('It applies from your next message.');
  await expect(card.getByRole('button', { name: 'Link', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Don’t' }).click();
  await expect(card.getByRole('status')).toContainText('Chose: Don’t.');
});
