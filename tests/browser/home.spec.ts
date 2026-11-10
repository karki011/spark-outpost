import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { decorateLatestRun, markVerifyFailed } from './home-seed.ts';
import { seedChats } from './sidebar-seed.ts';

const LONG_MESSAGE = Array.from(
  { length: 60 },
  (_, index) => `Line ${index + 1} of the brief.`,
).join('\n\n');

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-home-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const NOON = new Date(2026, 10, 10, 11, 0, 0);

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const headline = (page: Page) => home(page).getByRole('heading', { level: 1 });
const section = (page: Page, name: string | RegExp) => home(page).getByRole('region', { name });
const feed = (page: Page) => home(page).getByRole('list', { name: 'Needs you' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOON);
});

async function briefSettled(page: Page) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/home/digest');
        const state = (await response.json()) as { digest: { status: string } | null };
        return state.digest?.status ?? 'none';
      },
      { timeout: 15_000 },
    )
    .toMatch(/^(ready|failed|none)$/);
}

async function openHome(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await expect(home(page)).toBeVisible();
}

async function backHome(page: Page) {
  const rail = page.getByRole('navigation', { name: 'Main' });
  await rail.getByRole('button', { name: /^Chats/ }).click();
  await rail.getByRole('button', { name: /^Home/ }).click();
  await expect(home(page)).toBeVisible();
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

test('the app opens on Home and remembers the view the user chose', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Explain the checklist', run: { status: 'succeeded' } }]);
  const rail = page.getByRole('navigation', { name: 'Main' });
  await page.goto('/');
  await expect(home(page)).toBeVisible();
  await expect(rail.getByRole('button', { name: /^Home/ })).toHaveAttribute('aria-current', 'page');

  await rail.getByRole('button', { name: /^Chats/ }).click();
  await expect(page.getByRole('navigation', { name: 'Chats' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Chats' })).toBeVisible();
  await expect(rail.getByRole('button', { name: /^Chats/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(home(page)).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('spark-outpost.view', 'nowhere'));
  await page.reload();
  await expect(home(page)).toBeVisible();
});

test('the quiet Home greets by name, says nothing needs you and links to recent chats', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Explain the checklist', run: { status: 'succeeded' } }]);
  await openHome(page);

  await expect(headline(page)).toHaveText(
    'Good morning, Test. All quiet. Start something new below.',
  );
  await briefSettled(page);
  await expect(home(page).locator('.home-lead')).toBeEmpty();
  await expect(section(page, 'Pick up next')).toBeVisible();
  await expect(section(page, /^Working/)).toBeVisible();
  await expect(home(page).locator('.home-compose')).not.toHaveClass(/compact/);
  await expect(home(page).locator('.hrow', { hasText: 'Explain the checklist' })).toHaveCount(0);
  await home(page).getByRole('button', { name: 'Recent chats' }).click();
  await expect(page.getByRole('navigation', { name: 'Chats' })).toBeVisible();
});

test('the Home composer starts a chat in the background, keeps its model and starts without a project', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  const response = await page.request.post('/api/projects', { data: { rootPath: base } });
  expect(response.ok()).toBe(true);
  await openHome(page);

  const composer = home(page).getByRole('region', { name: 'Start a new chat' });
  await expect(home(page).locator('select')).toHaveCount(0);
  await expect(composer.getByRole('button', { name: 'Choose project' })).toBeVisible();
  const input = composer.getByRole('textbox', { name: 'Message' });
  await expect(input).not.toBeFocused();
  await expect(composer.getByRole('button', { name: 'Send' })).toBeDisabled();

  const picker = composer.getByRole('button', { name: /^Model and effort/ });
  await picker.click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('radio', { name: /Fake Deep/ }).click();
  await expect(picker).toHaveAccessibleName('Model and effort: Fake Deep');
  await page.keyboard.press('Escape');

  await input.fill('Summarise the home brief');
  await input.press('Enter');

  const started = composer.getByRole('status');
  await expect(started).toContainText('Started ‘Summarise the home brief’');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(home(page)).toBeVisible();
  await expect(
    section(page, /^Working/)
      .locator('.hrow')
      .first(),
  ).toContainText('Summarise the home brief');
  await expect(picker).toHaveAccessibleName('Model and effort: Fake Deep');
  await expect(composer.getByRole('button', { name: 'Choose project' })).toBeVisible();

  await started.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Summarise the home brief');
  await expect(page.getByRole('button', { name: /^Model and effort/ })).toHaveAccessibleName(
    'Model and effort: Fake Deep',
  );
});

test('a sent Home message is not restored when its settings fail to carry over', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openHome(page);
  const composer = home(page).getByRole('region', { name: 'Start a new chat' });
  const picker = composer.getByRole('button', { name: /^Model and effort/ });
  await picker.click();
  await page
    .getByRole('dialog', { name: 'Model, effort, and permissions' })
    .getByRole('radio', { name: /Fake Deep/ })
    .click();
  await expect(picker).toHaveAccessibleName('Model and effort: Fake Deep');
  await page.keyboard.press('Escape');

  let sent = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/messages')) sent += 1;
  });
  await page.route('**/api/conversations/*/settings', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, json: { error: 'Settings store is down' } })
      : route.fallback(),
  );
  const input = composer.getByRole('textbox', { name: 'Message' });
  await input.fill('Only send me once');
  await input.press('Enter');

  await expect(composer.getByRole('status').filter({ hasText: 'Started' })).toContainText(
    'Started ‘Only send me once’ · Open · New chats use your default model again',
  );
  await expect(input).toHaveValue('');
  expect(sent).toBe(1);
});

test('Needs you lists cards and errors the lead does not show, and jumps to the card', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Current chat' },
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' } },
    {
      title: 'Deploy the site',
      message: LONG_MESSAGE,
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await openHome(page);
  await expect(section(page, 'Since you left')).toBeVisible();
  await backHome(page);

  await expect(home(page).locator('.home-lead')).toBeEmpty();
  await expect(headline(page)).toHaveText('Good morning, Test. 1 thing needs you.');
  await expect(section(page, /^Needs you/).getByRole('heading', { level: 2 })).toHaveText(
    'Needs you 2',
  );
  await expect(feed(page).locator('.hrow-m b')).toHaveText(['Deploy the site', 'Mock fetch']);
  await expect(feed(page).locator('.hrow-m small')).toHaveText([
    /^Fake provider wants to run pnpm deploy · /,
    /^Stopped: rate limit reached · /,
  ]);
  await expect(feed(page).locator('.hstat')).toHaveText(['Waiting', 'Failed']);
  await expect(feed(page).getByRole('button')).toHaveText(['Answer', 'See error']);
  await expect(
    section(page, 'Ready for you to review').getByRole('button', {
      name: 'Review: Ship the notes',
    }),
  ).toBeVisible();

  await feed(page).getByRole('button', { name: 'Answer: Deploy the site' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Deploy the site');
  const approval = page.getByRole('group', { name: /^Run .+\?$/ });
  await expect(approval).toBeInViewport();
  await expect(approval).toHaveClass(/flash/);

  await backHome(page);
  await feed(page).getByRole('button', { name: 'See error: Mock fetch' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Mock fetch');
});

test('the Connect Linear or Jira line dismisses for the account and opens Tickets', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit.' } }]);
  await openHome(page);

  const hint = home(page).locator('.feed-foot');
  await expect(hint).toContainText(
    'Tickets and pull requests from Linear or Jira can show here too.',
  );
  await hint.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'See your tickets here' })).toBeVisible();

  await openHome(page);
  await hint.getByRole('button', { name: 'Don’t show this again' }).click();
  await expect(hint).toHaveCount(0);
  const saved = await page.request.get('/api/tickets/attention-settings');
  expect(((await saved.json()) as { connectHintDismissed: boolean }).connectHintDismissed).toBe(
    true,
  );
  await page.evaluate(() => localStorage.clear());
  await openHome(page);
  await expect(home(page).locator('.hrow').first()).toBeVisible();
  await expect(home(page).locator('.feed-foot')).toHaveCount(0);
});

test('Home reserves the lead with a skeleton while chats load', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit.' }, unread: true },
  ]);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/conversations', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/');
  const board = home(page).locator('.home-board');
  await expect(board).toHaveAttribute('aria-busy', 'true');
  await expect(home(page).getByTestId('home-lead-skeleton')).toBeVisible();
  await expect(home(page).locator('.hsk').first()).toBeVisible();
  release();
  await expect(section(page, 'Since you left').locator('.hrow')).toHaveCount(1);
  await expect(home(page).getByTestId('home-lead-skeleton')).toHaveCount(0);
  await expect(board).toHaveAttribute('aria-busy', 'false');
});

test('Working shows the step and plan progress, and updates live', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [, runningId] = await seedChats([
    { title: 'Current chat' },
    { title: 'Filter chips overflow', run: { status: 'running' } },
    { title: 'Worktree cleanup', run: { status: 'running' } },
  ]);
  await decorateLatestRun(runningId!, {
    provider: 'claude',
    step: 'Reading FilterBar.tsx',
    plan: ['completed', 'completed', 'in_progress', 'pending', 'pending'],
  });
  await openHome(page);

  await expect(headline(page)).toHaveText('Good morning, Test. 2 agents are working.');
  const running = section(page, /^Working/);
  await expect(running.getByRole('heading', { level: 2 })).toHaveText('Working 2');
  const card = running.locator('.hrow', { hasText: 'Filter chips overflow' });
  await expect(card).toContainText('Reading FilterBar.tsx');
  await expect(card.getByRole('progressbar', { name: 'Plan progress' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await expect(
    running.locator('.hrow', { hasText: 'Worktree cleanup' }).getByRole('progressbar'),
  ).toHaveAccessibleName('Progress, no plan yet');

  await setRun(runningId!, 'succeeded');
  await expect(
    section(page, 'Ready for you to review').locator('.hrow', { hasText: 'Filter chips overflow' }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(running.locator('.hrow')).toHaveCount(1);

  await running.getByRole('button', { name: 'Watch: Worktree cleanup' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Worktree cleanup');
});

test('the spend line shows today and opens usage', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], jev: true });
  const [claudeChat, codexChat] = await seedChats([
    { title: 'Routed by Jev', run: { status: 'succeeded' } },
    { title: 'Codex estimate', run: { status: 'succeeded' } },
  ]);
  await decorateLatestRun(claudeChat!, {
    provider: 'claude',
    model: 'claude-sonnet-5',
    costUsd: 0.64,
    input: 220_000,
    output: 20_000,
    routedByJev: true,
    jevCostUsd: 0.004,
  });
  await decorateLatestRun(codexChat!, {
    provider: 'codex',
    costUsd: 0.08,
    costSource: 'estimated',
    input: 40_000,
    output: 3_000,
  });
  await openHome(page);
  await briefSettled(page);
  await openHome(page);

  const spend = home(page).locator('.hspend');
  await expect(spend).toContainText('$0.73');
  await expect(spend).toContainText('includes estimates');
  await expect(spend).toContainText('spent today');
  await spend.getByRole('button', { name: 'Usage' }).click();
  await expect(page.getByRole('dialog', { name: 'Usage' })).toBeVisible();
});

test('Home names a provider that needs attention and links to the fix', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], jev: true });
  const [failed] = await seedChats([
    {
      title: 'Codex hit a limit',
      run: { status: 'failed', error: 'Codex is rate limited. Try again in a minute.' },
    },
  ]);
  await decorateLatestRun(failed!, { provider: 'codex' });
  await markVerifyFailed('claude', 'Claude replied with an error.');
  await openHome(page);

  const warning = home(page).locator('.ps-warn');
  await expect(warning).toContainText('Claude: Verify failed (+1 more)');
  await expect(home(page).getByRole('list', { name: 'AI providers' })).toHaveCount(0);
  await warning.getByRole('button', { name: 'Fix' }).click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  await expect(providers.getByRole('region', { name: 'Claude' })).toContainText('Error');
  await expect(page).toHaveURL(/#\/settings\/providers\/claude$/);
  await page.keyboard.press('Escape');
  await expect(providers.locator('.ptile[data-prov="codex"]')).toContainText(
    'Rate limited · just now',
  );
  await page.keyboard.press('Escape');
  await expect(providers).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/settings/);
});

test('Home fits a phone screen without sideways scrolling', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const title = 'A very long chat title that keeps going well past the edge of a phone screen';
  await seedChats([
    { title: 'Stopped', run: { status: 'failed', error: 'Rate limit reached.' }, unread: true },
    { title, run: { status: 'failed', error: 'Rate limit reached.' }, unread: true },
  ]);
  await page.setViewportSize({ width: 360, height: 780 });
  await openHome(page);
  await expect(section(page, 'Since you left')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await home(page).locator('.home-compose .composer').boundingBox();
  expect(box?.x).toBe(16);
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(344);
  const row = section(page, 'Since you left').locator('.hrow-m b', { hasText: title });
  await expect(row).toHaveAttribute('title', title);
  const clipped = await row.evaluate((element) => ({
    ellipsis: getComputedStyle(element).textOverflow,
    overflowing: element.scrollWidth > element.clientWidth,
    inside: element.getBoundingClientRect().right <= document.documentElement.clientWidth,
  }));
  expect(clipped).toEqual({ ellipsis: 'ellipsis', overflowing: true, inside: true });
  const columns = await home(page)
    .locator('.home-board')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);
});

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 720 }],
  ['phone', { width: 390, height: 700 }],
] as const) {
  test(`Home scrolls to its last section on ${name}`, async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    await seedChats(
      Array.from({ length: 6 }, (_, index) => ({
        title: `Stopped chat ${index + 1}`,
        run: { status: 'failed', error: 'Rate limit reached.' },
      })),
    );
    await page.setViewportSize(viewport);
    await openHome(page);
    const providers = home(page).getByRole('button', { name: 'Recent chats' });
    await expect(providers).not.toBeInViewport();
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    for (let turn = 0; turn < 12; turn += 1) await page.mouse.wheel(0, 600);
    await expect(providers).toBeInViewport();
  });
}
