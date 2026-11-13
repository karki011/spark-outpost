import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';
import { seedTerminal } from './terminal-seed.ts';

const SHOTS = process.env.PALETTE_SHOTS ?? '';
const companion = (page: Page) => page.getByRole('button', { name: /^Status: / });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Status' });
const root = (page: Page) => page.locator('.cmp');

async function goHome(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await expect(page.locator('#home-greet')).toBeVisible();
}

async function setRun(conversationId: string, status: string) {
  const db = openTestDb();
  try {
    await db.query(`UPDATE runs SET status = $2, finished_at = now() WHERE conversation_id = $1`, [
      conversationId,
      status,
    ]);
  } finally {
    await db.end();
  }
}

async function seedBusy() {
  const ids = await seedChats([
    { title: 'Current chat' },
    { title: 'Filter chips overflow', run: { status: 'running' } },
    {
      title: 'Deploy the site',
      message: Array.from({ length: 60 }, (_, index) => `Line ${index + 1}.`).join('\n\n'),
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Rotate', command: 'pnpm rotate' },
    },
  ]);
  await decorateLatestRun(ids[1]!, { provider: 'claude', step: 'Reading FilterBar.tsx' });
  return ids;
}

test('the companion hides in an open chat and shows status on Home', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedBusy();
  await openChats(page);
  await expect(page.locator('.chat-title')).toBeVisible();
  await expect(companion(page)).toHaveCount(0);

  await goHome(page);
  await expect(companion(page)).toHaveAccessibleName('Status: 2 need you, 1 running');
  await expect(root(page)).toHaveAttribute('data-mood', 'alert');
  await expect(root(page).locator('.cmp-badge')).toHaveText('2');
  const box = (await companion(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x + box.width).toBeGreaterThan(viewport.width - 80);
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 80);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Tickets/ })
    .click();
  await expect(companion(page)).toBeVisible();
});

test('the panel lists the live feed and jumps to the waiting card', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedBusy();
  await page.goto('/');
  await goHome(page);

  await companion(page).click();
  await expect(companion(page)).toHaveAttribute('aria-expanded', 'true');
  const status = panel(page);
  await expect(status.getByRole('region', { name: /^Needs you/ })).toContainText(
    'Fake provider wants to run pnpm deploy',
  );
  await expect(status.getByRole('region', { name: /^Running/ })).toContainText(
    'Reading FilterBar.tsx',
  );
  await expect(status.getByRole('button', { name: 'Open Home' })).toBeVisible();

  await status.getByRole('button', { name: 'Answer: Deploy the site' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Deploy the site');
  const approval = page.getByRole('group', { name: /^Run .+\?$/ });
  await expect(approval).toBeInViewport();
  await expect(companion(page)).toHaveCount(0);
});

test('the panel shows the step line of a working Terminal session', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [chat] = await seedChats([{ title: 'Port the parser' }]);
  await seedTerminal(chat!, {
    state: 'working',
    turn: {
      status: 'running',
      model: 'claude-sonnet-4-5',
      costUsd: 0.0832,
      steps: [{ name: 'Read' }, { name: 'Task', agentId: 'agent-1' }, { name: 'Bash', open: true }],
    },
  });
  await page.goto('/');
  await goHome(page);

  await expect(companion(page)).toHaveAccessibleName('Status: 1 running');
  await companion(page).click();
  const row = panel(page)
    .getByRole('region', { name: /^Running/ })
    .getByRole('listitem')
    .filter({ hasText: 'Port the parser' });
  const line = row.locator('small');
  await expect(line).toHaveText('Running a command · 3 steps · 1 sub-agent');
  expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  if (SHOTS) await panel(page).screenshot({ path: path.join(SHOTS, 'companion-terminal.png') });
  await expect(row).not.toContainText('$');
  await expect(row.getByRole('button', { name: 'Watch: Port the parser' })).toBeVisible();
});

test('the panel works from the keyboard and Escape returns focus', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Quiet chat', run: { status: 'succeeded' } }]);
  await page.goto('/');
  await goHome(page);

  await expect(companion(page)).toHaveAccessibleName('Status: all quiet');
  await companion(page).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toContainText('Nothing needs you and no agents are running.');
  const build = panel(page).getByRole('button', { name: 'Build a Spark or workflow' });
  await expect(build).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('button', { name: 'Open Home' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(panel(page).getByRole('button', { name: 'Hide companion' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(build).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(companion(page)).toBeFocused();
});

test('dragging snaps to the nearest corner and is remembered', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await goHome(page);

  const box = (await companion(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(400, 300, { steps: 8 });
  await page.mouse.move(200, 120, { steps: 8 });
  await page.mouse.up();
  await expect(root(page)).toHaveAttribute('data-corner', 'top-left');
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(async () => (await companion(page).boundingBox())?.y ?? 999).toBeLessThan(40);

  await page.reload();
  await goHome(page);
  await expect(root(page)).toHaveAttribute('data-corner', 'top-left');

  await companion(page).click();
  await panel(page).getByRole('radio', { name: 'Bottom right' }).click();
  await expect(root(page)).toHaveAttribute('data-corner', 'bottom-right');
});

test('hiding the companion and bringing it back from Settings', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await goHome(page);

  await companion(page).click();
  await panel(page).getByRole('button', { name: 'Hide companion' }).click();
  await expect(companion(page)).toHaveCount(0);
  await expect(
    page.locator('[aria-live="polite"]').filter({
      hasText: 'companion hidden. Turn it back on in Settings, Notifications.',
    }),
  ).toHaveCount(1);

  await page.reload();
  await goHome(page);
  await expect(companion(page)).toHaveCount(0);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Notifications' })
    .click();
  const settings = page.getByRole('dialog', { name: 'Notifications' });
  await settings
    .getByRole('radiogroup', { name: 'Status companion' })
    .getByRole('radio', { name: 'Show' })
    .click();
  await page.keyboard.press('Escape');
  await expect(companion(page)).toBeVisible();
});

test('the mood follows runs: working, then one happy bounce and a summary', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [, runningId] = await seedChats([
    { title: 'Current chat' },
    { title: 'Worktree cleanup', run: { status: 'running' } },
  ]);
  await page.goto('/');
  await goHome(page);
  await expect(root(page)).toHaveAttribute('data-mood', 'working');
  await expect(root(page).locator('.cmp-float')).toHaveCSS('animation-name', 'cmp-float');

  await setRun(runningId!, 'succeeded');
  await expect(root(page)).toHaveAttribute('data-celebrate', 'true', { timeout: 10_000 });
  await expect(root(page)).toHaveAttribute('data-mood', 'happy');
  await expect(root(page)).not.toHaveAttribute('data-celebrate', /.*/, { timeout: 5_000 });
  await expect(companion(page)).toHaveAccessibleName('Status: 1 finished');
  await expect(page.locator('.cmp-live')).toHaveText('Status: 1 finished', { timeout: 10_000 });
});

test('a failed run makes the companion sad until the panel is opened', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' } },
  ]);
  await page.goto('/');
  await goHome(page);
  await expect(root(page)).toHaveAttribute('data-mood', 'sad');
  await companion(page).click();
  await expect(panel(page).getByRole('region', { name: /^Failed/ })).toContainText(
    'Stopped: rate limit reached',
  );
  await expect(root(page)).toHaveAttribute('data-mood', 'idle');
});

test('reduced motion keeps a static mood with no float or pulse', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetTestDatabase({ onboarded: true });
  await seedBusy();
  await page.goto('/');
  await goHome(page);

  await expect(root(page)).toHaveAttribute('data-mood', 'alert');
  await expect(root(page).locator('.cmp-float')).toHaveCSS('animation-name', 'none');
  const ring = await companion(page).evaluate(
    (element) => getComputedStyle(element, '::after').animationName,
  );
  expect(ring).toBe('none');
});

test('on a phone there is no floating companion', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/');
  await goHome(page);

  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(companion(page)).toHaveCount(0);
});

test('many things at once: the most urgent mood, a count badge and capped lists', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Current chat' },
    ...Array.from({ length: 5 }, (_, index) => ({
      title: `Running chat ${index + 1}`,
      run: { status: 'running' },
    })),
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Rotate', command: 'pnpm rotate' },
    },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' } },
  ]);
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Tickets/ })
    .click();

  await expect(companion(page)).toHaveAccessibleName('Status: 2 need you, 5 running, 1 failed');
  await expect(root(page)).toHaveAttribute('data-mood', 'alert');
  await expect(root(page).locator('.cmp-badge')).toHaveText('2');
  await expect(root(page).locator('.cmp-run i')).toHaveCount(5);
  await expect(root(page).locator('.cmp-fail')).toBeVisible();

  await companion(page).click();
  const status = panel(page);
  await expect(status.getByRole('heading', { level: 3 })).toHaveText([
    'Needs you · 2',
    'Failed · 1',
    'Running · 5',
  ]);
  const running = status.getByRole('region', { name: /^Running/ });
  await expect(running.getByRole('listitem')).toHaveCount(4);
  await status.getByRole('button', { name: '1 more in Running on Home' }).click();
  await expect(page.locator('#home-greet')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});
