import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island, openHome, openIsland } from './island-home-desktop.ts';
import { openNotchIsland } from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';
import { seedTerminal, setTerminalState } from './terminal-seed.ts';

const SHOTS = process.env.PALETTE_SHOTS ?? '';
const THEMES = { dark: 'graphite', light: 'apricot' } as const;
const TURN = {
  status: 'running',
  model: 'claude-sonnet-4-5',
  costUsd: 0.0832,
  steps: [{ name: 'Read' }, { name: 'Task', agentId: 'agent-1' }, { name: 'Bash', open: true }],
};

async function snap(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  const box = (await island(page).boundingBox())!;
  await page.screenshot({
    path: path.join(SHOTS, `island-terminal-${name}.png`),
    clip: { x: box.x - 12, y: 0, width: box.width + 24, height: box.y + box.height + 16 },
  });
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

for (const [mode, theme] of Object.entries(THEMES)) {
  test(`a working Terminal session is a Running row in the inbox, with no commands or paths (${mode})`, async ({
    page,
  }) => {
    const [chat] = await seedChats([{ title: 'Port the parser', minutesAgo: 1 }]);
    await seedTerminal(chat!, { state: 'working', cwd: '/Users/ada/code/parser', turn: TURN });
    await fakeHomeDesktop(page, theme);
    await openIsland(page);
    await openHome(page);
    const running = island(page).getByRole('region', { name: /^Running/ });
    await expect(running.getByRole('listitem')).toHaveCount(1);
    await expect(running).toContainText('Port the parser');
    await expect(running).not.toContainText('$');
    await expect(running).not.toContainText('/Users/ada');
    await snap(page, `working-${mode}`);
    await setTerminalState(chat!, 'ready');
    await expect(running).toHaveCount(0);
  });
}

test('a Terminal turn that ends says so beside Scout once', async ({ page }) => {
  const [chat] = await seedChats([{ title: 'Port the parser' }]);
  await seedTerminal(chat!, { state: 'working' });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  const line = island(page).locator('.isl-restline');
  await expect(page.getByRole('button', { name: /^Chat: Port the parser/ })).toBeVisible();
  await expect(line).toHaveCount(0);
  await setTerminalState(chat!, 'ready');
  await expect(line).toHaveText('Port the parser is done.');
  await expect(line).toHaveAttribute('data-kind', 'done');
  if (SHOTS) {
    await page.waitForTimeout(900);
    await page.screenshot({
      path: path.join(SHOTS, 'island-terminal-done-line.png'),
      clip: { x: 240, y: 0, width: 800, height: 240 },
    });
  }
  await expect(line).toHaveCount(0, { timeout: 8_000 });
});
