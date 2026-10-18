import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { typeLine } from './native-terminal-fixture.ts';
import { openChats } from './navigation.ts';

const READY = 'Ready for terminal input. No provider request is made.';
const SHOTS = '.local/report';

async function startTerminal(page: Page): Promise<{ conversationId: string; workspace: Locator }> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page
    .getByRole('radiogroup', { name: 'Session type' })
    .getByRole('radio', { name: 'Terminal' })
    .click();
  await page.getByRole('button', { name: /^Terminal agent: / }).click();
  await page
    .getByRole('dialog', { name: 'Terminal agent and permissions' })
    .getByRole('tab', { name: 'Codex', exact: true })
    .click();
  await page.keyboard.press('Escape');
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
  const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
  await expect(workspace.locator('.xterm-accessibility')).toContainText(READY);
  await page.evaluate(() => navigator.clipboard.writeText('before'));
  return { conversationId: session.conversationId, workspace };
}

async function selectLine(page: Page, workspace: Locator, text: string) {
  const row = await workspace
    .locator('.xterm-accessibility-tree > div')
    .evaluateAll(
      (rows, wanted) => [rows.findIndex((each) => each.textContent?.includes(wanted)), rows.length],
      text,
    );
  const screen = (await workspace.locator('.xterm-screen').boundingBox())!;
  const y = screen.y + ((row[0]! + 0.5) * screen.height) / row[1]!;
  await page.mouse.click(screen.x + 24, y, { clickCount: 3 });
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const terminalHasFocus = (page: Page) =>
  page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea'));

async function expectInside(toolbar: Locator, pane: Locator) {
  const bar = (await toolbar.boundingBox())!;
  const stage = (await pane.boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(stage.x);
  expect(bar.y).toBeGreaterThanOrEqual(stage.y);
  expect(bar.x + bar.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(bar.y + bar.height).toBeLessThanOrEqual(stage.y + stage.height);
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  mkdirSync(SHOTS, { recursive: true });
});

test('a terminal selection is copied and offers Add to terminal, Ask, Comment and a new chat', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { conversationId, workspace } = await startTerminal(page);
  try {
    const screen = workspace.locator('.xterm-accessibility');
    const rows = workspace.locator('.xterm-accessibility-tree > div');
    const stage = workspace.locator('.native-stage');
    const toolbar = workspace.getByRole('toolbar', { name: 'Selected text' });
    await expect(toolbar).toHaveCount(0);
    expect(await clipboard(page)).toBe('before');

    await selectLine(page, workspace, READY);
    await expect(toolbar).toBeVisible();
    await expect.poll(() => clipboard(page)).toBe(READY);
    await expect(toolbar.getByRole('button')).toHaveText([
      'Add to terminal',
      'Ask about this',
      'Comment',
      'New chat with this',
      'Copied',
    ]);
    await expectInside(toolbar, stage);
    expect(await terminalHasFocus(page)).toBe(true);
    await page.screenshot({ path: path.resolve(SHOTS, 'terminal-select-toolbar.png') });
    await toolbar.getByRole('button', { name: 'Copied' }).hover();
    await page.screenshot({ path: path.resolve(SHOTS, 'terminal-select-copied.png') });

    await toolbar.getByRole('button', { name: 'Add to terminal' }).click();
    await expect(toolbar).toHaveCount(0);
    expect(await terminalHasFocus(page)).toBe(true);
    await expect(rows.filter({ hasText: READY })).toHaveCount(2);
    await expect(screen).not.toContainText('received[');
    await page.keyboard.type(' typed after');
    await page.keyboard.press('Enter');
    await expect(screen).toContainText(`]: ${READY} typed after`);

    await selectLine(page, workspace, 'Spark native terminal fixture');
    await expect(toolbar).toBeVisible();
    await page.keyboard.type('x');
    await expect(toolbar).toHaveCount(0);
    await page.keyboard.press('Backspace');

    await selectLine(page, workspace, 'Spark native terminal fixture');
    await expect(toolbar).toBeVisible();
    const box = (await workspace.locator('.xterm-screen').boundingBox())!;
    await page.mouse.click(box.x + box.width - 40, box.y + box.height - 20);
    await expect(toolbar).toHaveCount(0);

    await selectLine(page, workspace, 'Spark native terminal fixture');
    await toolbar.getByRole('button', { name: 'Comment' }).click();
    const note = toolbar.getByRole('textbox', { name: 'Note on the selected text' });
    await expect(note).toBeFocused();
    await note.fill('why this pid');
    await page.screenshot({ path: path.resolve(SHOTS, 'terminal-select-note.png') });
    await page.keyboard.press('Enter');
    await expect(toolbar).toHaveCount(0);
    expect(await terminalHasFocus(page)).toBe(true);
    await expect(screen).not.toContainText(/received\[\d+\]: >/);
    await page.keyboard.press('Enter');
    await expect(screen).toContainText(
      /received\[\d+\]: > Spark native terminal fixture · PID \d+ why this pid/,
    );

    await selectLine(page, workspace, 'Spark native terminal fixture');
    await page.keyboard.press('ControlOrMeta+Shift+A');
    await expect(toolbar).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(screen).toContainText(/received\[\d+\]: Spark native terminal fixture · PID \d+/);

    const width = async () => (await workspace.locator('.xterm-screen').boundingBox())!.width;
    const before = await width();
    await workspace.getByRole('button', { name: 'Focus terminal' }).click();
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await expect.poll(width).toBeGreaterThan(before);
    let last = before;
    await expect
      .poll(async () => {
        const now = await width();
        const settled = now === last;
        last = now;
        return settled;
      })
      .toBe(true);
    await selectLine(page, workspace, READY);
    await expect(toolbar).toBeVisible();
    await expectInside(toolbar, stage);
    await page.screenshot({ path: path.resolve(SHOTS, 'terminal-select-focus.png') });
    await workspace.getByRole('button', { name: 'Exit focus' }).focus();
    await page.keyboard.press('Tab');
    await expect(toolbar.getByRole('button', { name: 'Add to terminal' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar.getByRole('button', { name: 'Ask about this' })).toBeFocused();
    await page.screenshot({ path: path.resolve(SHOTS, 'terminal-select-focus-ring.png') });
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}/terminal`);
  }
});

test('an ended session keeps Copy and a new chat for its last output', async ({ page }) => {
  test.setTimeout(60_000);
  const { conversationId, workspace } = await startTerminal(page);
  try {
    const toolbar = workspace.getByRole('toolbar', { name: 'Selected text' });
    for (let row = 0; row < 30; row += 1) await typeLine(page, workspace, `row${row}`);
    await selectLine(page, workspace, 'row25');
    await expect(toolbar).toBeVisible();
    await page.mouse.wheel(0, -240);
    await expect(toolbar).toHaveCount(0);
    await page.keyboard.press('Control+d');
    await expect(workspace.getByRole('status').first()).toHaveText('Exited');
    await expect(workspace).toContainText('Its last output is shown below.');
    await expect
      .poll(async () => {
        await selectLine(page, workspace, 'row25');
        return clipboard(page);
      })
      .toBe('row25');
    await expect(toolbar.getByRole('button')).toHaveText(['New chat with this', 'Copied']);
    await page.screenshot({ path: path.resolve(SHOTS, 'terminal-select-ended.png') });
    await toolbar.getByRole('button', { name: 'New chat with this' }).click();
    await expect(workspace).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('> row25\n\n');
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}/terminal`);
  }
});

test('an agent that reports focus and uses the mouse keeps focus, Comment and Option-select', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { conversationId, workspace } = await startTerminal(page);
  try {
    const screen = workspace.locator('.xterm-accessibility');
    const toolbar = workspace.getByRole('toolbar', { name: 'Selected text' });
    const hint = workspace.getByText('Hold Option to select');
    const cell = async () => {
      const box = (await workspace.locator('.xterm-screen').boundingBox())!;
      const rows = await workspace.locator('.xterm-accessibility-tree > div').count();
      return Math.round(box.height / rows);
    };
    const spacing = await cell();
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(cell).toBe(spacing);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(cell).toBe(spacing);
    await workspace.locator('.native-screen').click();
    await expect(hint).toHaveCount(0);
    await page.keyboard.type('fixture focus on');
    await page.keyboard.press('Enter');
    await expect(screen).toContainText(/received\[\d+\]: fixture focus on/);
    await page.keyboard.type('fixture mouse on');
    await page.keyboard.press('Enter');
    await expect(hint).toBeVisible();

    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await terminalHasFocus(page)).toBe(true);

    await selectLine(page, workspace, READY);
    await expect(toolbar).toHaveCount(0);
    await page.keyboard.down('Alt');
    await selectLine(page, workspace, READY);
    await page.keyboard.up('Alt');
    await expect(toolbar).toBeVisible();
    await expect.poll(() => clipboard(page)).toBe(READY);
    await toolbar.getByRole('button', { name: 'Comment' }).click();
    const note = toolbar.getByRole('textbox', { name: 'Note on the selected text' });
    await expect(note).toBeFocused();
    await page.keyboard.press('Escape');

    await workspace.locator('.native-screen').click();
    await page.keyboard.type('fixture repaint');
    await page.keyboard.press('Enter');
    await page.keyboard.down('Alt');
    await selectLine(page, workspace, READY);
    await page.keyboard.up('Alt');
    await expect(toolbar).toBeVisible();
    await expect(screen).toContainText('Repainted in place.');
    await expect(toolbar).toHaveCount(0);
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');

    await page.keyboard.press('Alt+Tab');
    expect(await terminalHasFocus(page)).toBe(false);

    await workspace.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+d');
    await expect(workspace.getByRole('status').first()).toHaveText('Exited');
    await expect(workspace.getByRole('button', { name: 'Reconnect' })).toHaveCount(0);
    await expect(hint).toHaveCount(0);
    await selectLine(page, workspace, 'Spark native terminal fixture');
    await expect(toolbar.getByRole('button')).toHaveText(['New chat with this', 'Copied']);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}/terminal`);
  }
});

test('a toolbar survives the pointer crossing an agent that tracks every mouse move', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { conversationId, workspace } = await startTerminal(page);
  try {
    const rows = workspace.locator('.xterm-accessibility-tree > div');
    const toolbar = workspace.getByRole('toolbar', { name: 'Selected text' });
    await workspace.locator('.native-screen').click();
    await page.keyboard.type('fixture motion on');
    await page.keyboard.press('Enter');
    await expect(workspace.getByText('Hold Option to select')).toBeVisible();

    const area = (await workspace.locator('.xterm-screen').boundingBox())!;
    await page.mouse.move(area.x + 40, area.y + area.height - 40);
    await page.mouse.move(area.x + 400, area.y + area.height - 120, { steps: 30 });
    await page.keyboard.down('Alt');
    await selectLine(page, workspace, READY);
    await page.keyboard.up('Alt');
    await expect(toolbar).toBeVisible();
    await expect.poll(() => clipboard(page)).toBe(READY);

    await page.mouse.move(area.x + 300, area.y + 200, { steps: 40 });
    await page.mouse.move(area.x + 120, area.y + 90, { steps: 40 });
    await expect(toolbar).toBeVisible();
    const add = (await toolbar.getByRole('button', { name: 'Add to terminal' }).boundingBox())!;
    await page.mouse.move(add.x + add.width / 2, add.y + add.height / 2, { steps: 40 });
    await expect(toolbar).toBeVisible();
    await page.mouse.down();
    await page.mouse.up();
    await expect(toolbar).toHaveCount(0);
    await expect(rows.filter({ hasText: READY })).toHaveCount(2);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}/terminal`);
  }
});

test('a note opened long after selecting stays open while the agent repaints on losing focus', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { conversationId, workspace } = await startTerminal(page);
  try {
    const rows = workspace.locator('.xterm-accessibility-tree > div');
    const toolbar = workspace.getByRole('toolbar', { name: 'Selected text' });
    await workspace.locator('.native-screen').click();
    await page.keyboard.type('fixture motion on');
    await page.keyboard.press('Enter');
    await expect(workspace.getByText('Hold Option to select')).toBeVisible();

    await page.keyboard.down('Alt');
    await selectLine(page, workspace, READY);
    await page.keyboard.up('Alt');
    await expect(toolbar).toBeVisible();
    await page.waitForTimeout(4_000);
    await toolbar.getByRole('button', { name: 'Comment' }).click();
    const note = toolbar.getByRole('textbox', { name: 'Note on the selected text' });
    await expect(note).toBeFocused();
    await page.waitForTimeout(3_000);
    await expect(note).toBeFocused();
    await page.keyboard.type('why this');
    await toolbar.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(toolbar).toHaveCount(0);
    expect(await terminalHasFocus(page)).toBe(true);
    await expect(rows.filter({ hasText: `> ${READY} why this` })).toHaveCount(1);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}/terminal`);
  }
});
