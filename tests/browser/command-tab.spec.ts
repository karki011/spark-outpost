import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';
import { slot } from './stub-config.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const PASS = 'pnpm test --filter web';
const HANG = 'pnpm dev';
const PORT = slot === 0 ? 4878 : 20_000 + slot * 10 + 8;
const PREVIEW_URL = `http://127.0.0.1:${PORT}`;
const SERVER = `const http = require('node:http');
http
  .createServer((request, response) => response.end('<h1>Lantern Quay</h1>'))
  .listen(Number(process.env.PORT), '127.0.0.1', () => console.log('Lantern Quay is up'));
`;

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1300, height: 860 });
});

async function shot(target: Page | Locator, name: string) {
  if (SHOTS) await target.screenshot({ path: path.join(SHOTS, `agent-term-${name}.png`) });
}

async function ask(page: Page, message: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await input.press('Enter');
}

const mini = (page: Page, command: string) =>
  page.getByRole('region', { name: `Command: ${command}` });
const openButton = (box: Locator) => box.getByRole('button', { name: 'Open in terminal' });
const dock = (page: Page) => page.getByRole('region', { name: 'Terminal' });
const agentTab = (page: Page, command: string) =>
  dock(page).getByRole('button', { name: new RegExp(` · ${command}, run by the agent$`) });
const pane = (page: Page) =>
  dock(page).getByRole('group', { name: /, run by the agent, read-only$/ });
const rows = (scope: Locator) => scope.locator('.xterm-rows');
const status = (page: Page) => pane(page).getByRole('status');

test('Open in terminal mirrors a running command in a dock tab and shows how it ended', async ({
  page,
}) => {
  await ask(page, 'Run the tests #terminal=pass 500ms');
  const box = mini(page, PASS);
  await expect(rows(box)).toContainText('turns.test.ts', { timeout: 15_000 });
  await expect(dock(page)).toHaveCount(0);

  await openButton(box).click();
  const tab = agentTab(page, PASS);
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await expect(tab).toHaveAttribute('title', /run by the agent$/);
  await expect(tab.locator('.term-light.open')).toBeVisible();
  await expect(tab.locator('.term-tab-agent svg')).toBeVisible();
  await expect(pane(page)).toBeFocused();
  await expect(pane(page).locator('.spin')).toBeVisible();
  await expect(pane(page)).toContainText('Run by the agent · read-only');
  await expect(rows(pane(page))).toContainText('RUN  v5.0.1 apps/web');
  await expect(rows(pane(page))).toContainText('turns.test.ts');
  await expect(status(page)).toHaveText('This command belongs to the agent’s turn.');
  await expect(pane(page).getByRole('button', { name: 'Stop turn' })).toBeVisible();
  await expect(pane(page).locator('textarea:not([aria-hidden="true"]), input')).toHaveCount(0);

  await expect(status(page)).toHaveText('Finished, exit code 0.', { timeout: 20_000 });
  await expect(rows(pane(page))).toContainText('Tests 23 passed');
  await expect(pane(page).locator('.cmd-tab-state')).toHaveText(/exit 0 · \d+s/);
  await expect(tab.locator('.term-light.open')).toHaveCount(0);
  await expect(pane(page).getByRole('button', { name: 'Stop turn' })).toHaveCount(0);
  await expect(dock(page).getByRole('button', { name: 'Start a new terminal' })).toHaveCount(0);
  await expect(rows(box)).toContainText('Tests 23 passed');

  await openButton(box).click();
  await expect(dock(page).getByRole('button', { name: /run by the agent$/ })).toHaveCount(1);
});

test('the tab is reachable by keyboard, Stop turn stops the turn and a saved command reopens', async ({
  page,
}) => {
  await ask(page, 'Dev server #terminal=hang 20ms');
  const box = mini(page, HANG);
  await expect(rows(box)).toContainText('ready on http://localhost:5173', { timeout: 15_000 });

  await openButton(box).focus();
  await page.keyboard.press('Enter');
  await expect(pane(page)).toBeFocused();
  await expect(rows(pane(page))).toContainText('ready on http://localhost:5173');
  await page.keyboard.press('Tab');
  await expect(pane(page).getByRole('group', { name: 'Command output' })).toBeFocused();
  await page.keyboard.press('Tab');
  const stop = pane(page).getByRole('button', { name: 'Stop turn' });
  await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(status(page)).toHaveText(
    'Interrupted before it finished. This is what was captured.',
    { timeout: 15_000 },
  );
  await expect(box.locator('.run-cmd-state')).toHaveText('interrupted');
  await expect(stop).toHaveCount(0);

  const tab = agentTab(page, HANG);
  await tab.focus();
  await page.keyboard.press('Tab');
  await expect(dock(page).getByRole('button', { name: /^Close .* · pnpm dev$/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dock(page)).toHaveCount(0);
  await expect(box).toBeVisible();

  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText('Dev server').click();
  await openButton(mini(page, HANG)).click();
  await expect(rows(pane(page))).toContainText('ready on http://localhost:5173');
  await expect(pane(page).locator('.cmd-tab-state')).toHaveText('interrupted');
});

test('says output shows at the end for an agent that reports it once', async ({ page }) => {
  await ask(page, 'End only #terminal=final 2500ms');
  const box = mini(page, 'git status --short');
  await expect(box.locator('.run-cmd-note')).toHaveText('Output shows when the command ends.', {
    timeout: 15_000,
  });
  await openButton(box).click();
  await expect(pane(page).locator('.cmd-tab-note')).toHaveText(
    'Output shows when the command ends.',
  );
  await expect(agentTab(page, 'git status --short').locator('.term-light.open')).toBeVisible();
  await expect(rows(pane(page))).toContainText('?? notes.txt', { timeout: 15_000 });
  await expect(status(page)).toHaveText('Finished.');
});

test('shell and preview tabs still work next to an agent tab', async ({ page }) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-command-tab-')));
  const name = path.basename(root);
  try {
    writeFileSync(path.join(root, 'server.js'), SERVER);
    const linked = await page.request.post('/api/projects', { data: { rootPath: root } });
    const projectId = ((await linked.json()) as { id: string }).id;
    const saved = await page.request.put(`/api/projects/${projectId}/preview`, {
      data: { preview: { command: `${process.execPath} server.js`, url: PREVIEW_URL } },
    });
    expect(saved.ok()).toBe(true);
    await withDesktopBrowser(page);
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await page.locator('.ctx-repo').click();
    const folders = page.getByRole('dialog', { name: 'Project folders' });
    await folders.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await page.keyboard.press('Escape');

    await toggleHeaderPane(page, 'Browser');
    const browser = page.getByRole('region', { name: 'Browser' });
    await browser
      .getByRole('group', { name: 'Preview', exact: true })
      .getByRole('button', { name: 'Start preview' })
      .click();
    const live = browser.getByRole('group', { name: 'Preview server' });
    await expect(live).toContainText('Preview running', { timeout: 30_000 });
    await live.getByRole('button', { name: 'Show output' }).click();
    const previewTab = dock(page).getByRole('button', { name: 'Preview', exact: true });
    await expect(previewTab).toHaveAttribute('aria-pressed', 'true');
    const shellText = dock(page).locator('.xterm-accessibility');
    await expect(shellText).toContainText('Lantern Quay is up');

    const input = page.getByRole('textbox', { name: 'Message' });
    await input.fill('Run the tests #terminal=pass 30ms');
    await input.press('Enter');
    const box = mini(page, PASS);
    await expect(box.locator('.run-cmd-state')).toHaveText(/exit 0/, { timeout: 30_000 });
    await openButton(box).click();
    await expect(agentTab(page, PASS)).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(pane(page))).toContainText('Tests 23 passed');
    await expect(dock(page).locator('.term-where')).toHaveText('./');

    await dock(page).getByRole('button', { name: 'New terminal' }).click();
    const shellTab = dock(page).getByRole('button', { name: `my files · ${name}`, exact: true });
    await expect(shellTab).toHaveAttribute('aria-pressed', 'true');
    await expect(shellTab.locator('.term-light.open')).toBeVisible();
    await page.keyboard.type('echo "shell:$((40 + 2))"');
    await page.keyboard.press('Enter');
    await expect(shellText).toContainText('shell:42');

    await previewTab.click();
    await expect(shellText).toContainText('Lantern Quay is up');
    await agentTab(page, PASS).click();
    await expect(rows(pane(page))).toContainText('Tests 23 passed');
    await dock(page)
      .getByRole('button', { name: /^Close .* · pnpm test/ })
      .click();
    await expect(pane(page)).toHaveCount(0);
    await expect(previewTab).toBeVisible();
    await shellTab.click();
    await expect(shellText).toContainText('shell:42');
    await live.getByRole('button', { name: 'Stop preview' }).click();
    await expect(live).toBeHidden();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const theme of ['light', 'dark']) {
  test(`the button and the agent tab have no accessibility issues in the ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript((saved) => localStorage.setItem('spark-outpost.theme', saved), theme);
    await ask(page, 'Dev server #terminal=hang 20ms');
    const box = mini(page, HANG);
    await expect(rows(box)).toContainText('ready on http://localhost:5173', { timeout: 15_000 });
    await shot(box, `chat-button-${theme}`);
    await openButton(box).click();
    await expect(rows(pane(page))).toContainText('ready on http://localhost:5173');
    await expect(agentTab(page, HANG).locator('.term-light.open')).toBeVisible();

    const scan = () =>
      new AxeBuilder({ page })
        .include('.run-cmd')
        .include('#terminal-dock')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
    expect((await scan()).violations).toEqual([]);
    await shot(page, `dock-tab-running-${theme}`);

    await pane(page).getByRole('button', { name: 'Stop turn' }).click();
    await expect(status(page)).toHaveText(/^Interrupted before it finished\./, {
      timeout: 15_000,
    });
    expect((await scan()).violations).toEqual([]);
    await shot(page, `dock-tab-ended-${theme}`);
  });
}
