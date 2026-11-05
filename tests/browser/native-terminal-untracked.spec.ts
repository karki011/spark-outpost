import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { installFakeVoice } from './fake-voice.ts';
import { SESSION_START_MS } from './native-terminal-fixture.ts';
import { chooseSessionType, openChats } from './navigation.ts';
import { FAKE_CLAUDE_BIN } from './stub-config.ts';

const OPENCODE = path.join(FAKE_CLAUDE_BIN, 'opencode');
const AMP = path.join(FAKE_CLAUDE_BIN, 'amp');
const READY = 'OpenCode fixture started with no arguments';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  writeFileSync(
    OPENCODE,
    `#!/bin/sh\n[ "$#" = 0 ] && echo '${READY}'\nwhile IFS= read -r line; do echo "got $line"; done\n`,
    { mode: 0o755 },
  );
  rmSync(AMP, { force: true });
});

test.afterEach(() => {
  rmSync(OPENCODE, { force: true });
});

test('an installed CLI starts as an untracked Terminal session, and one not installed is not offered', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await installFakeVoice(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await chooseSessionType(page, 'Terminal');
  await page.getByRole('button', { name: /^Terminal agent: / }).click();
  const picker = page.getByRole('dialog', { name: 'Terminal agent and permissions' });
  const others = picker.getByRole('radiogroup', { name: 'Other agents' });
  await expect(others.getByRole('radio', { name: 'Amp' })).toBeDisabled();
  await expect(others.getByRole('radio', { name: 'Amp' })).toContainText('Not installed');
  await others.getByRole('radio', { name: 'OpenCode' }).click();
  await expect(others.getByRole('radio', { name: 'OpenCode' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(picker).toContainText('records only whether it is running');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Terminal agent: OpenCode' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What would you like to work on?' })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();

  const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
  await expect(workspace.locator('.xterm-accessibility')).toContainText(READY, {
    timeout: SESSION_START_MS,
  });
  await expect(workspace).toContainText('OpenCode · Terminal');
  await expect(workspace.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0);
  await workspace.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await expect(workspace.locator('.xterm-accessibility')).toContainText('got hello');
});
