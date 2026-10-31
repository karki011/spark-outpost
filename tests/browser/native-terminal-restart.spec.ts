import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island, openHome, openIsland } from './island-home-desktop.ts';
import { pointOf, startFixtureTerminal, typeLine } from './native-terminal-fixture.ts';
import { setTerminalState } from './terminal-seed.ts';
import { killApi, restartApi } from './api-restart.ts';
import { PACKAGED } from './stub-config.ts';

const built = path.resolve('.local/tmux', process.arch, 'bin/tmux');
const EVENTS_RECONNECT_MS = 20_000;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

async function terminalChatId(): Promise<string> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM conversations WHERE session_type = 'terminal'`,
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.id;
  } finally {
    await db.end();
  }
}

test('a Terminal session keeps running when the server is killed and says so after the restart', async ({
  page,
  request,
}) => {
  test.skip(!existsSync(built) || PACKAGED, 'Needs the tmux built by pnpm desktop:tmux.');
  test.setTimeout(90_000);
  const workspace = await startFixtureTerminal(page);
  const screen = workspace.locator('.xterm-accessibility');
  await typeLine(page, workspace, 'before the restart');
  await typeLine(page, workspace, 'fixture links');
  const received = /received\[(\d+)\]: before the restart/.exec((await screen.textContent()) ?? '');
  const pid = received![1]!;

  killApi();
  await expect(workspace.getByRole('status').first()).toContainText('Disconnected');
  await expect
    .poll(async () => (await request.get('/api/health').catch(() => null))?.ok() ?? false, {
      timeout: 60_000,
    })
    .toBe(true);

  const notice = workspace.locator('.native-restart');
  await expect(notice).toContainText(
    /^Spark restarted at \d{1,2}:\d{2}.*\. This session kept running\./,
    {
      timeout: 30_000,
    },
  );
  await expect(screen).toContainText(`received[${pid}]: before the restart`);
  await expect(workspace.getByRole('status').first()).not.toContainText('Disconnected');
  await typeLine(page, workspace, 'after the restart');
  await expect(screen).toContainText(`received[${pid}]: after the restart`);

  const link = await pointOf(workspace, 'the docs');
  await page.mouse.move(link.x, link.y, { steps: 4 });
  await expect(workspace.locator('.xterm-cursor-pointer')).toHaveCount(1);

  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Terminal session', exact: true })).toBeVisible();
  await expect(page.locator('.native-restart')).toHaveCount(0);
});

test('the sidebar, the palette, the island and the companion follow a re-adopted session @packaged', async ({
  page,
  context,
  request,
}) => {
  test.skip(!existsSync(built), 'Needs the tmux built by pnpm desktop:tmux.');
  test.setTimeout(120_000);
  const workspace = await startFixtureTerminal(page);
  const bar = workspace.getByRole('status').first();
  const row = page.getByRole('navigation', { name: 'Chats' }).locator('[aria-current="page"]');
  const islandPage = await context.newPage();
  await fakeHomeDesktop(islandPage);
  await openIsland(islandPage);
  await openHome(islandPage);
  const islandRunning = island(islandPage).getByRole('region', { name: /^Working/ });
  const homePage = await context.newPage();
  await homePage.addInitScript(() => localStorage.setItem('spark-outpost.view', 'home'));
  await homePage.goto('/');
  await expect(homePage.locator('#home-greet')).toBeVisible();
  const running = homePage.getByRole('button', { name: 'Status: 1 running' });

  await setTerminalState(await terminalChatId(), 'working');
  await expect(bar).toHaveText('Running');
  await expect(row).toHaveAttribute('title', /Terminal session · Running · /);
  await expect(islandRunning.getByRole('listitem')).toHaveCount(1);
  await expect(running).toBeVisible();

  await restartApi(request);
  const notice = workspace.locator('.native-restart');
  await expect(notice).toContainText('This session kept running.', { timeout: 30_000 });
  await expect(bar).toHaveText('Open');
  const reconnected = { timeout: EVENTS_RECONNECT_MS };
  await expect(row).toHaveAttribute('title', /Terminal session · Open · /, reconnected);
  await expect(islandRunning).toHaveCount(0, reconnected);
  await expect(running).toHaveCount(0, reconnected);
  const dismiss = notice.getByRole('button', { name: 'Dismiss' });
  const colours = await dismiss.evaluate((button) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--muted)';
    button.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    return { icon: getComputedStyle(button.querySelector('svg')!).color, muted };
  });
  expect(colours.icon).toBe(colours.muted);

  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(workspace).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+K');
  const palette = page.getByRole('dialog', { name: 'Sessions' });
  await palette.getByRole('combobox', { name: 'Find a session' }).fill('fixture');
  await expect(palette.getByRole('option').locator('.sp-state')).toHaveText('Open');
  await page.keyboard.press('Enter');
  await expect(workspace.getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
  await typeLine(page, workspace, 'after the palette');

  await page.keyboard.press('Control+D');
  await expect(bar).toHaveText('Exited');
  await expect(row).toHaveAttribute('title', /Terminal session · Exited · /);
  await expect(islandRunning).toHaveCount(0);
});
