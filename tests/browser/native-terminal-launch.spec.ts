import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { FIXTURE_READY, startFixtureTerminal, typeLine } from './native-terminal-fixture.ts';
import { pickTerminalAgent } from './native-terminal-support.ts';
import { chatRepo } from './project-chat-kit.ts';
import { openChats } from './navigation.ts';
import { connectTickets, openTickets, resetTicketFakes } from './ticket-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test('terminal launch selection preserves chat and lets the user pick a native agent @packaged', async ({
  page,
}) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const choice = page.getByRole('radiogroup', { name: 'Session type' });
  await expect(choice.getByRole('radio', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await choice.getByRole('radio', { name: 'Terminal' }).click();
  await expect(page.getByRole('heading', { name: 'Work in your terminal' })).toBeVisible();
  const composer = page.locator('.composer-wrap');
  await expect(composer.getByRole('radiogroup', { name: 'Session type' })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Choose project', exact: true })).toBeVisible();
  await expect(composer.getByRole('button', { name: /^Permissions: / })).toBeVisible();
  await expect(composer).toContainText('Terminal sessions don’t open pull requests automatically');
  await expect(page.getByRole('button', { name: 'Start terminal', exact: true })).toBeDisabled();
  await pickTerminalAgent(page, 'Codex');
  await expect(
    page.getByText('The real Codex interface, with Spark tools and your project context.'),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Inspect this project.');
  await expect(page.getByRole('button', { name: 'Start terminal', exact: true })).toBeEnabled();
  await choice.getByRole('radio', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start terminal', exact: true })).toHaveCount(0);
  await expect(page.locator('.composer textarea')).toBeVisible();
});

test('ticket launch keeps Terminal separate from Plan first and Build @packaged', async ({
  page,
}) => {
  await resetTicketFakes();
  await connectTickets(page, ['linear']);
  await openTickets(page);
  await page.getByRole('main', { name: 'Tickets' }).locator('li[data-ticket$=":ENG-1210"]').hover();
  await page.getByRole('button', { name: 'Start ENG-1210' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start work on ENG-1210' });
  await dialog
    .getByRole('radiogroup', { name: 'Session type' })
    .getByRole('radio', { name: 'Terminal' })
    .click();
  await dialog.getByRole('button', { name: 'Terminal agent', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Codex', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Plan first', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await dialog.getByRole('radio', { name: 'Build', exact: true }).click();
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/tickets/linear/ENG-1210/start', async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test launch stopped before executing an agent.' }),
    });
  });
  await dialog.getByRole('button', { name: 'Start building', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Test launch stopped before executing an agent.',
  );
  expect(submitted).toMatchObject({
    sessionType: 'terminal',
    terminalProvider: 'codex',
    mode: 'build',
    moveToInProgress: true,
  });
});

test('failed terminal creation unlocks session and agent choices @packaged', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const sessions = page.getByRole('radiogroup', { name: 'Session type' });
  await sessions.getByRole('radio', { name: 'Terminal' }).click();
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Inspect the project.');
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Creation temporarily unavailable.' }),
    });
  });
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Creation temporarily unavailable.' }),
  ).toBeVisible();
  await expect(sessions.getByRole('radio', { name: 'Chat', exact: true })).toBeEnabled();
  await pickTerminalAgent(page, 'Codex');
  await sessions.getByRole('radio', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.composer textarea')).toBeVisible();
});

test('a failed first terminal launch unlocks the choices and leaves no dead session @packaged', async ({
  page,
}) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const sessions = page.getByRole('radiogroup', { name: 'Session type' });
  await sessions.getByRole('radio', { name: 'Terminal' }).click();
  const prompt = page.getByRole('textbox', { name: 'What would you like to work on?' });
  await prompt.fill('Inspect the project.');
  await page.route(/\/api\/conversations\/[^/]+\/terminal$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Claude Code is not installed.' }),
    });
  });
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Claude Code is not installed.' }),
  ).toBeVisible();
  await expect(sessions.getByRole('radio', { name: 'Chat', exact: true })).toBeEnabled();
  await page.reload();
  await expect(sessions.getByRole('radio', { name: 'Chat', exact: true })).toBeEnabled();
  await sessions.getByRole('radio', { name: 'Terminal' }).click();
  await expect(prompt).toBeVisible();
});

test('a starting terminal names the phase it is in and clears it when the terminal opens', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const repo = chatRepo();
  writeFileSync(path.join(repo.root, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nsleep 3\n', {
    mode: 0o755,
  });
  const db = openTestDb();
  try {
    const linked = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
    expect(linked.ok()).toBe(true);
    await db.query(`UPDATE projects SET work_place = 'worktree' WHERE root_path = $1`, [repo.root]);
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await page
      .getByRole('radiogroup', { name: 'Session type' })
      .getByRole('radio', { name: 'Terminal' })
      .click();
    await pickTerminalAgent(page, 'Codex');
    await page.getByRole('button', { name: 'Choose project', exact: true }).click();
    const folders = page.getByRole('dialog', { name: 'Project folders' });
    await folders.getByRole('button', { name: new RegExp(`^${path.basename(repo.root)}`) }).click();
    await expect(folders.getByRole('list', { name: 'Linked repos' })).toContainText(
      path.basename(repo.root),
    );
    await page.keyboard.press('Escape');
    await page
      .getByRole('textbox', { name: 'What would you like to work on?' })
      .fill('Inspect the fixture.');
    await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
    const phase = 'Creating this session’s worktree…';
    await expect(page.locator('.composer-notice').first()).toHaveText(phase);
    await expect(page.getByRole('button', { name: phase, exact: true })).toBeDisabled();
    const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
    await expect(workspace.locator('.xterm-accessibility')).toContainText(FIXTURE_READY, {
      timeout: 20_000,
    });
    await expect(page.getByText(phase)).toHaveCount(0);
    await expect(page.getByText('Starting terminal…')).toHaveCount(0);
  } finally {
    await db.end();
    repo.remove();
  }
});

test('a terminal opens in its worktree and is usable while dependencies are still installing', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const repo = chatRepo();
  repo.commit('package.json', '{"name":"app","packageManager":"pnpm@10.0.0"}');
  repo.commit('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  repo.commit('.spark-test-slow-install', '6\n');
  const db = openTestDb();
  try {
    const linked = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
    expect(linked.ok()).toBe(true);
    await db.query(`UPDATE projects SET work_place = 'worktree' WHERE root_path = $1`, [repo.root]);
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await page
      .getByRole('radiogroup', { name: 'Session type' })
      .getByRole('radio', { name: 'Terminal' })
      .click();
    await pickTerminalAgent(page, 'Codex');
    await page.getByRole('button', { name: 'Choose project', exact: true }).click();
    const folders = page.getByRole('dialog', { name: 'Project folders' });
    await folders.getByRole('button', { name: new RegExp(`^${path.basename(repo.root)}`) }).click();
    await expect(folders.getByRole('list', { name: 'Linked repos' })).toContainText(
      path.basename(repo.root),
    );
    await page.keyboard.press('Escape');
    await page
      .getByRole('textbox', { name: 'What would you like to work on?' })
      .fill('Inspect the fixture.');
    await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
    const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
    await expect(workspace.locator('.xterm-accessibility')).toContainText(FIXTURE_READY);
    const notice = workspace.getByText(
      'Dependencies are still installing. Commands that need them may fail until this finishes.',
    );
    await expect(notice).toBeVisible();
    await typeLine(page, workspace, 'still usable');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(0, { timeout: 20_000 });
    await expect(workspace.locator('.xterm-accessibility')).toContainText('still usable');
    expect(existsSync(path.join(repo.work(), 'node_modules'))).toBe(true);
  } finally {
    await db.end();
    repo.remove();
  }
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a database reset stops the Terminal session an earlier test left running', async ({
  page,
}) => {
  const workspace = await startFixtureTerminal(page);
  const screen = await workspace.locator('.xterm-accessibility').textContent();
  const pid = Number(/PID (\d+)/.exec(screen!)![1]);
  expect(isRunning(pid)).toBe(true);
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await expect.poll(() => isRunning(pid)).toBe(false);
});
