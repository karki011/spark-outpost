import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { seedConversation, seedTurn } from '../../apps/server/test/outcome-seed.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SHOTS = '.local/shots';

async function pluginCardChat(overrides: Record<string, unknown> = {}): Promise<void> {
  const action = {
    action: 'plugins_edit',
    key: 'tools@market',
    name: 'tools',
    version: '1.2.0',
    enabled: true,
    fingerprint: 'f'.repeat(64),
    status: 'review',
    agentReview: 'done',
    hold: true,
    findings: [
      {
        source: 'check',
        severity: 'review',
        rule: 'inline-shell',
        file: 'commands/today.md',
        line: 4,
        reason: 'Runs a shell command without asking when it loads.',
      },
    ],
    hooks: [{ event: 'Stop', matcher: '*', command: 'echo done' }],
    inlineShell: [{ file: 'commands/today.md', line: 4, text: 'The date is !`date +%F`.' }],
    mcpServers: [{ name: 'notes', target: 'node notes.js' }],
    agent: 'Claude',
    modeName: 'Bypass permissions',
    ...overrides,
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
    { optionId: 'confirm', name: 'Turn on', kind: 'allow_once' },
    { optionId: 'decline', name: 'Don’t turn on', kind: 'reject_once' },
  ];
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const conversationId = await seedConversation(db, workspaceId);
    const runId = await seedTurn(db, conversationId, {
      request: 'Turn the tools plugin on',
      status: 'awaiting_approval',
    });
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status)
       VALUES ($1, $2, $3, 'spark_action', 'Turn on “tools” for Claude chats?', $4, 'hash', $5,
         'pending')`,
      [randomUUID(), runId, `spark:plugins_edit:${randomUUID()}`, payload, JSON.stringify(options)],
    );
  } finally {
    await db.end();
  }
}

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await page.setViewportSize({ width: 1400, height: 900 });
});

async function openCard(page: Page) {
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('button', { name: 'Outcomes', exact: true })
    .click();
  return page.getByRole('group', { name: /Turn on “tools” for Claude chats\?/ });
}

test('an agent’s request to turn on a plugin with findings needs the hold', async ({ page }) => {
  await pluginCardChat();
  const card = await openCard(page);
  await expect(card).toContainText('Claude · Bypass permissions');
  await expect(card).toContainText('Review · 1 finding');
  await expect(card).not.toContainText('Agent review');
  await expect(card).not.toContainText('Findings');
  await expect(card).toContainText('echo done');
  await expect(card).toContainText('The date is !`date +%F`.');
  await expect(card).toContainText('node notes.js');
  await expect(card.getByRole('button', { name: 'Turn on', exact: true })).toHaveCount(0);
  const hold = card.getByRole('button', { name: /Hold to turn on/ });
  await expect(hold).toBeVisible();
  await expect(hold).toHaveAccessibleDescription('Hold 1.5 seconds, with the mouse or Space.');
  const deny = card.getByRole('button', { name: 'Don’t turn on' });
  await expect(deny).toBeVisible();
  const [holdBox, denyBox] = [await hold.boundingBox(), await deny.boundingBox()];
  expect(Math.abs(holdBox!.y - denyBox!.y)).toBeLessThan(4);

  await mkdir(SHOTS, { recursive: true });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await card.screenshot({ path: `${SHOTS}/plugins-edit-card-v2-light.png` });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await card.screenshot({ path: `${SHOTS}/plugins-edit-card-v2-dark.png` });

  await deny.click();
  await expect(card.getByRole('status')).toContainText('Chose: Don’t turn on.');
  await expect(card.getByText('Turn on “tools” for Claude chats?')).toHaveCount(1);
});

test('a clean plugin is turned on with Turn on, and long lists fold', async ({ page }) => {
  await pluginCardChat({
    status: 'clean',
    hold: false,
    findings: [],
    hooks: ['Stop', 'PreToolUse', 'PostToolUse', 'SessionStart', 'Notification'].map((event) => ({
      event,
      matcher: null,
      command: `echo ${event}`,
    })),
    inlineShell: [],
  });
  const card = await openCard(page);
  await expect(card).toContainText('Clean');
  await expect(card).not.toContainText('finding');
  await expect(card.getByRole('button', { name: /Hold to/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Turn on', exact: true })).toBeVisible();
  await expect(card).not.toContainText('echo Notification');
  const more = card.getByRole('button', { name: 'and 2 more' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await mkdir(SHOTS, { recursive: true });
  await card.screenshot({ path: `${SHOTS}/plugins-edit-card-v2-clean.png` });

  await more.click();
  await expect(card).toContainText('echo Notification');
  await expect(card.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('the card shows each finding’s plain title, with the rule id beside it', async ({ page }) => {
  await pluginCardChat({
    findings: [
      {
        source: 'agent',
        severity: 'review',
        rule: 'transcript-content-exfil-to-notifier',
        title: 'Sends parts of your chats to a helper script',
        file: 'scripts/on-stop.sh',
        line: 18,
        reason: 'Passes the last prompt and reply to the notifier script.',
      },
      {
        source: 'agent',
        severity: 'review',
        rule: 'unquoted-terminal-escape',
        file: 'scripts/notify.sh',
        line: 9,
        reason: 'Writes notification text to the terminal without escaping it.',
      },
    ],
  });
  const card = await openCard(page);
  const items = card.locator('dt:has-text("Findings") + dd li');
  await expect(items.locator('b')).toHaveText([
    'Sends parts of your chats to a helper script',
    'Unquoted terminal escape',
  ]);
  await expect(items.locator('.sac-plug-rule')).toHaveText([
    'transcript-content-exfil-to-notifier',
    'unquoted-terminal-escape',
  ]);
});
