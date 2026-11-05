import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RemoteSession } from '../../packages/contracts/src/remote.ts';
import {
  agentTerminalFolder,
  BUILD,
  seedAgentTerminal,
  SERVE,
  stopSeededTerminals,
} from './agent-terminal-seed.ts';
import { resetTestDatabase } from './database.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const STILL_RUNNING = '1 agent terminal still running.';

let work: ReturnType<typeof agentTerminalFolder>;

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1300, height: 860 });
  work = agentTerminalFolder();
});

test.afterEach(async () => {
  await stopSeededTerminals();
  work.remove();
});

async function shot(target: Page | Locator, name: string) {
  if (SHOTS) await target.screenshot({ path: path.join(SHOTS, `agent-term2-${name}.png`) });
}

async function ask(page: Page, message: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await input.press('Enter');
}

async function finishedChat(page: Page, title: string) {
  await ask(page, title);
  await expect(page.getByRole('button', { name: 'Copy reply' })).toBeVisible({ timeout: 20_000 });
}

const row = (page: Page, command: string) =>
  page.getByRole('region', { name: `Agent terminal: ${command}` });
const rowState = (page: Page, command: string) => row(page, command).locator('.run-cmd-state');
const openButton = (scope: Locator) => scope.getByRole('button', { name: 'Open in terminal' });
const stopButton = (scope: Locator) => scope.getByRole('button', { name: 'Stop', exact: true });
const dock = (page: Page) => page.getByRole('region', { name: 'Terminal', exact: true });
const agentTab = (page: Page, command: string) =>
  dock(page).getByRole('button', { name: new RegExp(` · ${command}, run by the agent$`) });
const pane = (page: Page) =>
  dock(page).getByRole('group', { name: /, run by the agent, read-only$/ });
const live = (page: Page) => pane(page).locator('.agent-tab-screen .xterm-accessibility');
const status = (page: Page) => pane(page).getByRole('status');

test('a terminal Spark runs shows in the reply, opens read-only in the dock and stops from the tab @packaged', async ({
  page,
}) => {
  await ask(page, 'Start the dev server #terminal=pass 900ms');
  await expect(page.getByRole('region', { name: /^Command: / })).toBeVisible({ timeout: 15_000 });
  await seedAgentTerminal(work.folder, SERVE);

  const box = row(page, SERVE);
  await expect(box).toBeVisible();
  await expect(box).toContainText('Agent terminal');
  await expect(rowState(page, SERVE)).toHaveText(/^running · \d+s$/);
  await expect(box.getByRole('status')).toHaveText(`Agent terminal running ${SERVE}`);
  await expect(dock(page)).toHaveCount(0);

  await openButton(box).click();
  const tab = agentTab(page, SERVE);
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await expect(tab).toHaveAttribute('title', /run by the agent$/);
  await expect(tab.locator('.term-light.open')).toBeVisible();
  await expect(tab.locator('.term-tab-agent svg')).toBeVisible();
  await expect(pane(page)).toContainText('Run by the agent · read-only');
  await expect(live(page)).toContainText('Harbor Light is up');
  await expect(live(page)).toContainText('tick 3');
  await expect(dock(page).locator('.term-where')).toHaveText(work.folder);
  await expect(status(page)).toHaveText(/Closing the tab does not stop it\.$/);

  await pane(page).locator('.agent-tab-screen').click();
  await page.keyboard.type('zebra-input');
  await page.keyboard.press('Enter');
  const seen = (await live(page).textContent()) ?? '';
  const next = Number(/tick (\d+)(?![\s\S]*tick \d)/.exec(seen)?.[1] ?? 0) + 3;
  await expect(live(page)).toContainText(`tick ${next}`);
  await expect(live(page)).not.toContainText('zebra');

  await expect(row(page, SERVE).locator('..').getByText(STILL_RUNNING)).toBeVisible({
    timeout: 30_000,
  });
  await expect(rowState(page, SERVE)).toHaveText(/^running · /);

  await stopButton(pane(page)).click();
  await expect(status(page)).toHaveText('How it ended: stopped by you.');
  await expect(rowState(page, SERVE)).toHaveText(/^stopped by you · /);
  await expect(tab.locator('.term-light.open')).toHaveCount(0);
  await expect(stopButton(pane(page))).toHaveCount(0);
  await expect(stopButton(box)).toHaveCount(0);
  await expect(live(page)).toContainText(/tick \d+/);
  await expect(page.getByText(STILL_RUNNING)).toHaveCount(0);
  await expect(dock(page).getByRole('button', { name: 'Start a new terminal' })).toHaveCount(0);
});

test('it keeps running after the turn, its tab comes back after a reload and Stop works from the row', async ({
  page,
}) => {
  await finishedChat(page, 'Harbor notes');
  await seedAgentTerminal(work.folder, SERVE);
  await expect(rowState(page, SERVE)).toHaveText(/^running · /);
  await expect(page.getByText(STILL_RUNNING)).toBeVisible();
  await expect(dock(page)).toHaveCount(0);

  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Harbor notes').click();
  await expect(rowState(page, SERVE)).toHaveText(/^running · /);
  await expect(page.getByText(STILL_RUNNING)).toBeVisible();
  await toggleHeaderPane(page, 'Terminal');
  const tab = agentTab(page, SERVE);
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await expect(tab.locator('.term-light.open')).toBeVisible();
  await expect(dock(page).getByRole('button', { name: /^Close / })).toHaveCount(1);
  await expect(live(page)).toContainText('Harbor Light is up');
  await expect(live(page)).toContainText('tick 2');

  await dock(page)
    .getByRole('button', { name: /^Close .* · sh serve\.sh$/ })
    .click();
  await expect(dock(page)).toHaveCount(0);
  await expect(rowState(page, SERVE)).toHaveText(/^running · /);

  await stopButton(row(page, SERVE)).click();
  await expect(rowState(page, SERVE)).toHaveText(/^stopped by you · /);
  await expect(stopButton(row(page, SERVE))).toHaveCount(0);
  await expect(page.getByText(STILL_RUNNING)).toHaveCount(0);

  await openButton(row(page, SERVE)).click();
  await expect(pane(page).locator('.xterm-rows')).toContainText(/tick \d+/);
  await expect(status(page)).toHaveText('How it ended: stopped by you.');
});

test('stopping the turn stops the terminal that turn started, and the row and the tab say so', async ({
  page,
}) => {
  await ask(page, 'Dev server #terminal=hang 20ms');
  await expect(page.getByRole('region', { name: 'Command: pnpm dev' })).toBeVisible({
    timeout: 15_000,
  });
  await seedAgentTerminal(work.folder, SERVE);
  await expect(rowState(page, SERVE)).toHaveText(/^running · /);
  await openButton(row(page, SERVE)).click();
  await expect(live(page)).toContainText('tick 2');

  await page.locator('button.send.busy').click();
  await expect(rowState(page, SERVE)).toHaveText(/^stopped with the turn · /, { timeout: 15_000 });
  await expect(status(page)).toHaveText('How it ended: stopped with the turn.');
  await expect(stopButton(pane(page))).toHaveCount(0);
});

test('an ended terminal shows its saved output and how it ended', async ({ page }) => {
  await finishedChat(page, 'Build notes');
  await seedAgentTerminal(work.folder, BUILD);
  await expect(rowState(page, BUILD)).toHaveText(/^exit 3 · \d+s$/, { timeout: 15_000 });
  await expect(row(page, BUILD).getByRole('status')).toHaveText(`Agent terminal exit 3: ${BUILD}`);
  await expect(stopButton(row(page, BUILD))).toHaveCount(0);
  await expect(page.getByText(STILL_RUNNING)).toHaveCount(0);

  await openButton(row(page, BUILD)).click();
  await expect(agentTab(page, BUILD).locator('.term-light.ended')).toBeVisible();
  await expect(pane(page).locator('.xterm-rows')).toContainText('built 42 files');
  await expect(pane(page).locator('.cmd-tab-state')).toHaveText(/^exit 3 · /);
  await expect(status(page)).toHaveText('How it ended: exit 3.');
  await expect(stopButton(pane(page))).toHaveCount(0);
  await expect(dock(page).getByRole('button', { name: 'Start a new terminal' })).toHaveCount(0);
});

test('the row and the tab are reachable by keyboard', async ({ page }) => {
  await finishedChat(page, 'Keyboard notes');
  await seedAgentTerminal(work.folder, SERVE);
  const box = row(page, SERVE);
  await openButton(box).focus();
  await page.keyboard.press('Tab');
  await expect(stopButton(box)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(pane(page)).toBeFocused();
  await expect(live(page)).toContainText('Harbor Light is up');
  await page.keyboard.press('Tab');
  await expect(pane(page).locator('.xterm-helper-textarea')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(stopButton(pane(page))).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('How it ended: stopped by you.');

  await agentTab(page, SERVE).focus();
  await page.keyboard.press('Tab');
  await expect(dock(page).getByRole('button', { name: /^Close .* · sh serve\.sh$/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dock(page)).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`the row, the line and the tab have no accessibility issues in the ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript((saved) => localStorage.setItem('spark-outpost.theme', saved), theme);
    await finishedChat(page, 'Harbor notes');
    await seedAgentTerminal(work.folder, SERVE);
    const box = row(page, SERVE);
    await expect(rowState(page, SERVE)).toHaveText(/^running · /);
    await expect(page.getByText(STILL_RUNNING)).toBeVisible();
    await shot(box, `row-running-${theme}`);
    await shot(page, `turn-line-${theme}`);

    await openButton(box).click();
    await expect(live(page)).toContainText('tick 2');
    const scan = () =>
      new AxeBuilder({ page })
        .include('.agent-term')
        .include('.agent-term-running')
        .include('#terminal-dock')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
    expect((await scan()).violations).toEqual([]);
    await shot(page, `dock-running-${theme}`);

    await stopButton(pane(page)).click();
    await expect(status(page)).toHaveText('How it ended: stopped by you.');
    const ended = new AxeBuilder({ page })
      .include('.agent-term')
      .include('#terminal-dock')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
    expect((await ended.analyze()).violations).toEqual([]);
    await shot(page, `dock-ended-${theme}`);
  });
}

test('a paired device sees the state as text, with no Open in terminal and no Stop', async ({
  page,
}) => {
  await finishedChat(page, 'Phone notes');
  await seedAgentTerminal(work.folder, SERVE);
  await expect(rowState(page, SERVE)).toHaveText(/^running · /);

  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as RemoteSession;
    await route.fulfill({
      response,
      json: {
        ...session,
        remote: true,
        device: { id: '00000000-0000-4000-8000-000000000001', name: 'Maya’s iPhone' },
        address: 'https://mac.tail.test',
      } satisfies RemoteSession,
    });
  });
  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Phone notes').click();
  const box = row(page, SERVE);
  await expect(box).toContainText(SERVE);
  await expect(rowState(page, SERVE)).toHaveText(/^running · /);
  await expect(page.getByText(STILL_RUNNING)).toBeVisible();
  await expect(box.getByRole('button')).toHaveCount(0);
  await expect(dock(page)).toHaveCount(0);
  await expect(page.locator('.term-park .term-host')).toHaveCount(0);
});
