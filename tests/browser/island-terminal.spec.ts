import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island, openIsland } from './island-home-desktop.ts';
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
  test(`a working Terminal session is a Working tile on Home, with no commands or paths (${mode})`, async ({
    page,
  }) => {
    const [chat] = await seedChats([{ title: 'Port the parser', minutesAgo: 1 }]);
    await seedTerminal(chat!, { state: 'working', cwd: '/Users/ada/code/parser', turn: TURN });
    await fakeHomeDesktop(page, theme);
    await openIsland(page);
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await island(page).locator('.isl-strip').click();
    const working = island(page).getByRole('region', { name: /^Working/ });
    await expect(working.getByRole('listitem')).toHaveCount(1);
    await expect(working).toContainText('Port the parser');
    await expect(working).not.toContainText('$');
    await expect(working).not.toContainText('/Users/ada');
    await snap(page, `working-${mode}`);
    await setTerminalState(chat!, 'ready');
    await expect(working).toHaveCount(0);
    await expect(island(page).getByRole('region', { name: 'Nothing needs you' })).toBeVisible();
  });
}

test('a working Terminal session rests as a working count, and an ended turn leaves Scout alone with no line', async ({
  page,
}) => {
  const [chat] = await seedChats([{ title: 'Port the parser' }]);
  await seedTerminal(chat!, { state: 'working' });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await expect(island(page).getByLabel('1 working', { exact: true })).toBeVisible();
  await setTerminalState(chat!, 'ready');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(island(page).locator('.isl-restline')).toHaveCount(0);
  await expect(island(page).locator('.isl-pbadge')).toHaveCount(0);
  if (SHOTS) {
    await page.waitForTimeout(900);
    await page.screenshot({
      path: path.join(SHOTS, 'island-terminal-ended.png'),
      clip: { x: 240, y: 0, width: 800, height: 240 },
    });
  }
});
