import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { pickTerminalAgent } from './native-terminal-support.ts';
import { chooseSessionType, openChats } from './navigation.ts';
import { FAKE_CLAUDE_BIN } from './stub-config.ts';

const SEQUENTIAL_HOOKS_MS = 20_000;

const CLI = path.resolve('tests/browser/terminal-usage-cli.ts');
const CODEX_FIXTURE = path.join(FAKE_CLAUDE_BIN, 'codex-usage-fixture');

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  writeFileSync(
    path.join(FAKE_CLAUDE_BIN, 'claude'),
    `#!/bin/sh\nexec '${process.execPath}' '${CLI}' "$@"\n`,
    { mode: 0o755 },
  );
  writeFileSync(CODEX_FIXTURE, `#!/bin/sh\nexec '${process.execPath}' '${CLI}' codex "$@"\n`, {
    mode: 0o755,
  });
});

test.afterEach(() => {
  rmSync(CODEX_FIXTURE, { force: true });
});

async function measuredLimits() {
  const db = openTestDb();
  try {
    await db.query(`UPDATE native_terminal_sessions SET measure = $1::jsonb, measured_at = now()`, [
      JSON.stringify({
        context: { tokens: 50_000, window: 200_000, percent: 25 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 23.5, resetsAt: null },
          { kind: 'seven_day', percentUsed: 7, resetsAt: null },
        ],
        costUsd: 0.03,
      }),
    ]);
  } finally {
    await db.end();
  }
}

test('a Codex Terminal session shows its steps and tokens by turn, with no reported total', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await chooseSessionType(page, 'Terminal');
  await pickTerminalAgent(page, 'Codex');
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Run the usage fixture.');
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
  await expect(workspace.locator('.xterm-accessibility')).toContainText('Turn finished.', {
    timeout: SEQUENTIAL_HOOKS_MS,
  });
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  const show = page.getByRole('button', { name: 'Show work panel' });
  if (await show.isVisible()) await show.click();
  await panel.getByRole('tab', { name: 'Steps' }).click();
  const steps = panel.getByRole('region', { name: 'Turn 1 steps' });
  await expect(steps.getByRole('listitem')).toHaveText([/Running a command/]);
  await expect(steps.getByRole('img', { name: 'Done' })).toHaveCount(1);
  await panel.getByRole('tab', { name: 'Cost' }).click();
  const turns = panel.getByRole('list', { name: 'Usage by turn' });
  await expect(turns).toContainText('34K tokens');
  await expect(turns).toContainText('gpt-5.6-sol');
  await expect(turns).toContainText('~$0.05 estimated from tokens');
  await expect(panel.getByRole('region', { name: 'Session total' })).toContainText(
    'unknown: Codex reports no cost',
  );
  await page.screenshot({ path: path.resolve('.local/report/terminal-usage-codex.png') });
  await workspace.getByRole('button', { name: 'Focus terminal' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await workspace.getByRole('button', { name: 'Exit focus' }).click();
  await expect(panel.getByRole('list', { name: 'Usage by turn' })).toContainText('34K tokens');
});

test('a Terminal session shows its steps, tokens by turn and the total the CLI reports at exit', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await chooseSessionType(page, 'Terminal');
  await pickTerminalAgent(page, 'Claude Code');
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Run the usage fixture.');
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
  const screen = workspace.locator('.xterm-accessibility');
  await expect(screen).toContainText('Turn finished.', {
    timeout: SEQUENTIAL_HOOKS_MS,
  });
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  const show = page.getByRole('button', { name: 'Show work panel' });
  if (await show.isVisible()) await show.click();
  await panel.getByRole('tab', { name: 'Steps' }).click();
  const steps = panel.getByRole('region', { name: 'Turn 1 steps' });
  await expect(steps.getByRole('listitem')).toHaveText([/Running a command/, /Reading/]);
  await expect(steps.getByRole('img', { name: 'Failed' })).toHaveCount(1);
  await expect(panel).not.toContainText('not stored');
  await page.screenshot({ path: path.resolve('.local/report/terminal-usage-steps.png') });
  await panel.getByRole('tab', { name: 'Cost' }).click();
  const turns = panel.getByRole('list', { name: 'Usage by turn' });
  await expect(turns.getByRole('listitem')).toHaveCount(1);
  await expect(turns).toContainText('41.4K tokens');
  await expect(turns).toContainText('estimated from tokens');
  const total = panel.getByRole('region', { name: 'Session total' });
  await expect(total).toContainText('unknown until Claude Code exits and writes its own total');
  await page.screenshot({ path: path.resolve('.local/report/terminal-usage-cost-open.png') });
  await expect(panel.getByRole('region', { name: 'Usage limits' })).toHaveCount(0);
  await measuredLimits();
  await workspace.locator('.native-screen').click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(total).toContainText('reported by Claude Code');
  await expect(total).toContainText('$0.03');
  await expect(total.getByRole('list', { name: 'Session total by model' })).toContainText(
    'claude-haiku-5-5',
  );
  const limits = panel.getByRole('region', { name: 'Usage limits' });
  await expect(limits).toContainText('5-hour limit');
  await expect(limits).toContainText('23.5% used');
  await expect(limits).toContainText('7-day limit');
  await expect(limits).toContainText('50K of 200K tokens');
  await page.screenshot({ path: path.resolve('.local/report/terminal-usage-cost-reported.png') });
});
