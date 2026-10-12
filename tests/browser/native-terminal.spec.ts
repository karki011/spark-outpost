import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { connectTickets, openTickets, resetTicketFakes } from './ticket-seed.ts';

async function pickTerminalAgent(page: Page, name: 'Claude Code' | 'Codex') {
  await page.getByRole('button', { name: /^Terminal agent: / }).click();
  await page
    .getByRole('dialog', { name: 'Terminal agent and permissions' })
    .getByRole('tab', { name, exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Terminal agent: ${name}` })).toBeVisible();
}

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

test('terminal uses the chat folder browser and preserves linked folders at launch @packaged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-native-folder-')));
  const folder = path.join(root, 'terminal-project');
  mkdirSync(folder);
  try {
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await page
      .getByRole('radiogroup', { name: 'Session type' })
      .getByRole('radio', { name: 'Terminal' })
      .click();
    const input = page.getByRole('textbox', { name: 'What would you like to work on?' });
    await input.fill('Inspect the selected folder.');
    await page.getByRole('button', { name: 'Choose project', exact: true }).click();
    const projectButton = (await page
      .getByRole('button', { name: 'Choose project', exact: true })
      .boundingBox())!;
    await expect
      .poll(async () => {
        const menu = (await page.getByRole('dialog', { name: 'Project folders' }).boundingBox())!;
        return menu.y + menu.height;
      })
      .toBeLessThanOrEqual(projectButton.y);
    await page
      .getByRole('dialog', { name: 'Project folders' })
      .getByRole('button', { name: 'Choose a folder…' })
      .click();
    const browser = page.getByRole('dialog', { name: 'Choose a project folder' });
    await expect(browser).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Choose project', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Choose project', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Project folders' })
      .getByRole('button', { name: 'Choose a folder…' })
      .click();
    await browser
      .getByRole('navigation', { name: 'Folder path' })
      .getByRole('button')
      .first()
      .click();
    for (const segment of folder.split('/').filter(Boolean)) {
      await browser
        .getByRole('list', { name: 'Folders' })
        .getByRole('button', { name: segment, exact: true })
        .click();
      await expect(browser.locator('.fdlg-path')).toHaveText(new RegExp(`/${segment}$`));
    }
    let releaseFolder = () => {};
    const folderGate = new Promise<void>((resolve) => {
      releaseFolder = resolve;
    });
    await page.route('**/api/conversations/*/settings', async (route) => {
      if (route.request().method() === 'PATCH' && route.request().postDataJSON().projectIds?.length)
        await folderGate;
      await route.continue();
    });
    await browser.getByRole('button', { name: 'Use this folder' }).click();
    await expect(page.getByRole('button', { name: 'Linking folder…', exact: true })).toBeDisabled();
    releaseFolder();
    await expect(browser).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Project folders: terminal-project' }),
    ).toBeFocused();
    await expect(input).toHaveValue('Inspect the selected folder.');
    await page
      .getByRole('radiogroup', { name: 'Session type' })
      .getByRole('radio', { name: 'Chat', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Project folders: terminal-project' }),
    ).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'Session type' })
      .getByRole('radio', { name: 'Terminal' })
      .click();
    const projects = (await (await page.request.get('/api/projects')).json()) as {
      id: string;
      rootPath: string;
    }[];
    const project = projects.find((entry) => entry.rootPath === folder)!;
    expect(project).toBeTruthy();
    await input.fill('Inspect the selected folder.');
    await page.screenshot({
      path: path.resolve('.local/report/native-terminal-picker.png'),
      fullPage: true,
    });
    let launchedId = '';
    await page.route('**/api/conversations/*/terminal', async (route) => {
      launchedId = route.request().url().split('/').at(-2)!;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fixture stops before starting a provider.' }),
      });
    });
    await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Fixture stops before starting a provider.' }),
    ).toBeVisible();
    const detail = await (await page.request.get(`/api/conversations/${launchedId}`)).json();
    expect(detail.conversation.projectIds).toEqual([project.id]);
    expect(detail.conversation.sessionType).toBe('terminal');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native terminal keeps its process across reconnects, fills the pane in focus and stops explicitly @packaged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'dark'));
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page
    .getByRole('radiogroup', { name: 'Session type' })
    .getByRole('radio', { name: 'Terminal' })
    .click();
  await pickTerminalAgent(page, 'Codex');
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Inspect the fixture.');
  const launched = page.waitForResponse(
    (response) =>
      /\/api\/conversations\/[^/]+\/terminal$/.test(response.url()) &&
      response.request().method() === 'POST',
  );
  const resizes: { cols: number; rows: number }[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      if (typeof frame.payload !== 'string' || !frame.payload.includes('"resize"')) return;
      resizes.push(JSON.parse(frame.payload) as { cols: number; rows: number });
    }),
  );
  let launchRequests = 0;
  let releaseLaunch = () => {};
  const launchGate = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });
  await page.route('**/api/conversations/*/terminal', async (route) => {
    if (route.request().method() === 'POST') {
      launchRequests += 1;
      await launchGate;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  await expect.poll(() => launchRequests).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Starting terminal…', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Terminal session', exact: true })).toHaveCount(0);
  releaseLaunch();
  const response = await launched;
  expect(response.status(), await response.text()).toBe(201);
  const { session } = (await response.json()) as {
    session: { id: string; conversationId: string };
  };
  const db = openTestDb();
  try {
    const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
    const screen = workspace.locator('.xterm-accessibility');
    await expect(workspace).toBeVisible();
    expect(launchRequests).toBe(1);
    await expect(
      workspace.locator('.native-companion .isl-sblob[data-terminal=true]'),
    ).toBeVisible();
    await expect(screen).toContainText('Spark native terminal fixture');
    await expect(workspace.getByRole('status').first()).toHaveText('Open');
    await expect(screen).toContainText('Color mode: truecolor');
    await expect(workspace).not.toContainText('Detailed activity is unavailable');
    await expect(workspace.getByRole('button', { name: 'Terminal help' })).toHaveCount(0);
    const row = page.locator(`[data-chat="${session.conversationId}"]`);
    const marker = await row.locator('.row-terminal-mark').boundingBox();
    const title = await row.locator('.row-title-line .tt').boundingBox();
    expect(marker).not.toBeNull();
    expect(title).not.toBeNull();
    expect(Math.abs(marker!.y + marker!.height / 2 - title!.y - title!.height / 2)).toBeLessThan(2);
    expect(marker!.x).toBeLessThan(title!.x);
    const processId = async () =>
      (
        await db.query<{ pid: number }>('SELECT pid FROM terminal_shells WHERE id = $1', [
          session.id,
        ])
      ).rows[0]?.pid;
    await expect.poll(processId).toBeGreaterThan(0);
    const pid = await processId();
    await expect(screen).toContainText(`PID ${pid}`);
    await workspace.locator('.native-screen').click();
    await page.keyboard.type('before-hide');
    await page.keyboard.press('Enter');
    await expect(screen).toContainText(`received[${pid}]: before-hide`);
    const transfer = await page.evaluateHandle(() => {
      Object.assign(window, {
        sparkDesktop: { island: { pathForFile: (file: File) => `/tmp/${file.name}` } },
      });
      const data = new DataTransfer();
      data.items.add(new File([], 'my file.txt'));
      data.items.add(new File([], "a'b;$()` folder"));
      return data;
    });
    const dropped = "'/tmp/my file.txt' '/tmp/a'\\''b;$()` folder' ";
    await workspace.locator('.native-screen').dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(workspace.locator('.native-screen')).toHaveAttribute('data-file-drag', 'true');
    await workspace.locator('.native-screen').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(screen).toContainText(dropped);
    await expect(screen).not.toContainText(`received[${pid}]: ${dropped}`);
    await page.keyboard.press('Enter');
    await expect(screen).toContainText(`received[${pid}]: ${dropped}`);
    await expect(page.locator('.file-drop')).toHaveCount(0);
    await transfer.dispose();
    const invalid = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File([], 'bad\nname'));
      return data;
    });
    await workspace.locator('.native-screen').dispatchEvent('drop', { dataTransfer: invalid });
    await expect(workspace.getByRole('alert')).toContainText('control characters');
    await expect(workspace.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
    await invalid.dispose();

    await expect(workspace.getByRole('button', { name: 'Hide view' })).toHaveCount(0);
    await expect(workspace.locator('.tbar-place')).toHaveAttribute('title', /terminal-workspaces/);
    await expect(workspace.locator('.tbar-mode')).toContainText('Approve for me');
    const attached = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith(`/api/terminal/sessions/${session.id}/attach`) &&
        candidate.request().method() === 'POST',
    );
    await workspace.getByRole('button', { name: 'Terminal actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy folder path' })).toBeFocused();
    await page.getByRole('menuitem', { name: 'Reconnect' }).click();
    expect((await attached).ok()).toBe(true);
    expect(await processId()).toBe(pid);
    await expect(screen).toContainText(`received[${pid}]: before-hide`);
    await workspace.locator('.native-screen').click();
    await page.keyboard.type('after-reopen');
    await page.keyboard.press('Enter');
    await expect(screen).toContainText(`received[${pid}]: after-reopen`);
    await page.reload();
    await expect(screen).toContainText(`received[${pid}]: after-reopen`);
    await workspace.locator('.native-screen').click();
    await page.keyboard.type('after-reload');
    await page.keyboard.press('Enter');
    await expect(screen).toContainText(`received[${pid}]: after-reload`);
    expect(await processId()).toBe(pid);
    expect(
      (await db.query('SELECT id FROM runs WHERE conversation_id = $1', [session.conversationId]))
        .rowCount,
    ).toBe(1);
    mkdirSync('.local/report', { recursive: true });
    await page.screenshot({
      path: path.resolve('.local/report/native-terminal-packaged.png'),
      fullPage: true,
    });
    const cols = () => resizes.at(-1)?.cols ?? 0;
    const before = cols();
    expect(before).toBeGreaterThan(0);
    await expect(page.locator('.app')).not.toHaveClass(/collapsed/);
    await workspace.getByRole('button', { name: 'Focus terminal' }).click();
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await expect.poll(cols).toBeGreaterThan(before);
    const stage = (await workspace.locator('.native-stage').boundingBox())!;
    const rows = (await workspace.locator('.xterm-screen').boundingBox())!;
    const pane = (await page.locator('main.main').boundingBox())!;
    expect(Math.abs(stage.x - pane.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(stage.x + stage.width - pane.x - pane.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(stage.y + stage.height - pane.y - pane.height)).toBeLessThanOrEqual(1);
    expect(rows.x + rows.width).toBeLessThanOrEqual(stage.x + stage.width);
    expect(stage.width - rows.width).toBeLessThan(40);
    await page.keyboard.press('Escape');
    await expect(workspace.getByRole('button', { name: 'Exit focus' })).toBeVisible();
    await page.reload();
    await expect(workspace.getByRole('button', { name: 'Exit focus' })).toBeVisible();
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await workspace.locator('.native-screen').click();
    await page.keyboard.press('ControlOrMeta+Shift+F');
    await expect(workspace.getByRole('button', { name: 'Focus terminal' })).toBeVisible();
    await expect(page.locator('.app')).not.toHaveClass(/collapsed/);
    await expect.poll(cols).toBe(before);
    await workspace.getByRole('button', { name: 'Terminal actions' }).click();
    await page.getByRole('menuitem', { name: 'Stop session' }).click();
    const hold = workspace.getByRole('button', { name: 'Hold to stop', exact: true });
    await hold.focus();
    await page.keyboard.down('Space');
    await page.waitForTimeout(1700);
    await page.keyboard.up('Space');
    await expect(workspace).toContainText('This terminal session has stopped.');
    await expect(
      workspace.getByRole('button', { name: 'Resume session', exact: true }),
    ).toHaveCount(0);
    await expect(workspace.getByRole('button', { name: 'Start again', exact: true })).toHaveCount(
      0,
    );
    await expect.poll(processId).toBeUndefined();
  } finally {
    await page.request.delete(`/api/conversations/${session.conversationId}/terminal`);
    await db.end();
  }
});

test('an exited terminal session starts again in the same chat @packaged', async ({ page }) => {
  test.setTimeout(60_000);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page
    .getByRole('radiogroup', { name: 'Session type' })
    .getByRole('radio', { name: 'Terminal' })
    .click();
  await pickTerminalAgent(page, 'Codex');
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Inspect the fixture.');
  const launched = page.waitForResponse(
    (response) =>
      /\/api\/conversations\/[^/]+\/terminal$/.test(response.url()) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  const { session } = (await (await launched).json()) as { session: { conversationId: string } };
  try {
    const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
    const screen = workspace.locator('.xterm-accessibility');
    await expect(screen).toContainText('Ready for terminal input.');
    const firstPid = /PID (\d+)/.exec((await screen.textContent())!)![1];
    await workspace.locator('.native-screen').click();
    await page.keyboard.press('Control+d');
    await expect(workspace.getByRole('status').first()).toHaveText('Exited');
    await expect(workspace).toContainText('Its last output is shown below.');
    await expect(screen).toContainText(`PID ${firstPid}`);
    await expect(
      workspace.getByRole('button', { name: 'Resume session', exact: true }),
    ).toHaveCount(0);
    await workspace.getByRole('button', { name: 'Start again', exact: true }).click();
    await expect(workspace.getByRole('status').first()).toHaveText('Open');
    await expect(screen).toContainText('Ready for terminal input.');
    await expect(screen).not.toContainText(`PID ${firstPid}`);
    await expect(workspace.getByRole('button', { name: 'Start again', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await page.request.delete(`/api/conversations/${session.conversationId}/terminal`);
  }
});
