import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { pointOf, startFixtureTerminal, typeLine } from './native-terminal-fixture.ts';
import { API_PORT, API_RESTART_FLAG, PACKAGED } from './stub-config.ts';

const built = path.resolve('.local/tmux', process.arch, 'bin/tmux');

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

function killApi(): void {
  mkdirSync(path.dirname(API_RESTART_FLAG), { recursive: true });
  writeFileSync(API_RESTART_FLAG, '');
  const pid = execFileSync('lsof', ['-ti', `tcp:${API_PORT}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  process.kill(Number(pid.trim().split('\n')[0]), 'SIGKILL');
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
