import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island, nowCard, openHome, openIsland } from './island-home-desktop.ts';
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
  test(`a working Terminal session shows its step line and model, then Finished when the turn ends (${mode})`, async ({
    page,
  }) => {
    const [chat] = await seedChats([{ title: 'Port the parser', minutesAgo: 1 }]);
    await seedTerminal(chat!, { state: 'working', cwd: '/Users/ada/code/parser', turn: TURN });
    await fakeHomeDesktop(page, theme);
    await openIsland(page);
    await openHome(page);

    const note = nowCard(page).locator('.isl-now-note');
    await expect(nowCard(page).locator('.isl-now-agent')).toHaveText('Claude');
    await expect(note).toHaveText('Running · 3 steps · 1 sub-agent · Sonnet 4.5');
    for (const part of ['.isl-now-title', '.isl-now-agent', '.isl-now-note']) {
      const cut = await nowCard(page)
        .locator(part)
        .evaluate((el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
      expect(cut, part).toBe(false);
    }
    await expect(nowCard(page).getByRole('list', { name: 'Latest steps' })).toContainText(
      'Now: Running',
    );
    await expect(nowCard(page).locator('.isl-now-dot')).toHaveAttribute('data-state', 'working');
    await expect(nowCard(page)).not.toContainText('$');
    await expect(nowCard(page).getByRole('button', { name: /^Reply/ })).toHaveCount(0);
    await snap(page, `working-${mode}`);

    await setTerminalState(chat!, 'ready');
    await expect(note).toHaveText('Terminal sessionFinished · 3 steps · 1 sub-agent · Sonnet 4.5');
    await expect(nowCard(page).locator('.isl-now-fact')).toHaveText(/^Claude · (\S.* · )?parser$/);
    await expect(nowCard(page).locator('.isl-now-dot')).toHaveAttribute('data-state', 'done');
    await snap(page, `done-${mode}`);

    await island(page).getByRole('tab', { name: 'Chats' }).click();
    const row = island(page).getByRole('option', { name: /Port the parser/ });
    await expect(row.locator('.isl-schip')).toHaveText(/^Terminal session · Done · /);
    await expect(row.locator('.isl-sp2')).toHaveText('parser · Claude');
    await snap(page, `done-list-${mode}`);
    await row.click();
    await expect(island(page).locator('.isl-sstatus')).toHaveText(
      'Finished · 3 steps · 1 sub-agent · Sonnet 4.5',
    );
    await expect(island(page).getByRole('button', { name: 'Ask for update' })).toBeDisabled();
    await expect(island(page).getByRole('textbox')).toHaveCount(0);
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
