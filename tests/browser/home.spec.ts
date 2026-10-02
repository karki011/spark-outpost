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

const home = (page: Page) =>
  page.getByRole('main', { name: /^Good (morning|afternoon|evening)|^Working late/ });
const section = (page: Page, name: string | RegExp) => home(page).getByRole('region', { name });
const today = (page: Page) => section(page, /^What needs you today/);
const feed = (page: Page) => home(page).getByRole('list', { name: 'Needs you' });

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

test('the quiet Home greets by name and says nothing needs you', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Explain the checklist', run: { status: 'succeeded' } }]);
  await openHome(page);

  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(
    /^(Good (morning|afternoon|evening)|Working late), Test$/,
  );
  await expect(home(page).locator('.home-summary')).toHaveText(
    'All quiet. Start something new below.',
  );
  await briefSettled(page);
  await expect(today(page)).toHaveCount(0);
  await expect(section(page, 'Pick up where you left off')).toHaveCount(0);
  await expect(home(page).locator('.hquiet')).toHaveCount(0);
  await expect(section(page, /^Running now/)).toHaveCount(0);
  const recent = section(page, 'Recent chats').getByRole('button', {
    name: /Explain the checklist/,
  });
  await expect(recent).toHaveAttribute('title', 'Explain the checklist');
  await expect(recent.locator('.k')).toHaveText(/^(Just now|\d+m ago)$/);
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
    section(page, /^Running now/)
      .locator('.hcard')
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

test('the Needs you feed lists asking, then errors, then finished chats and jumps to the card', async ({
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

  await expect(home(page).locator('.home-summary')).toHaveText('3 things need you.');
  await expect(today(page).getByRole('heading', { level: 2 })).toHaveText('What needs you today 3');
  await home(page).getByRole('button', { name: '3 things need you' }).click();
  await expect(feed(page).locator('.lr-main').first()).toBeFocused();
  await expect(feed(page).locator('.lr-main .t')).toHaveText([
    'Deploy the site',
    'Mock fetch',
    'Ship the notes',
  ]);
  await expect(feed(page).locator('.why-r')).toHaveText([
    'Fake provider wants to run pnpm deploy',
    'Stopped: rate limit reached',
    'Finished · open to review',
  ]);
  await expect(feed(page).locator('.age').first()).toHaveText(/^(now|\d+m)$/);
  await expect(feed(page).locator('.qa')).toHaveText(['Answer', 'See error', 'Review']);
  await expect(home(page).locator('.hcard')).toHaveCount(0);
  await expect(home(page).locator('.hquiet')).toHaveCount(0);

  const first = feed(page).locator('.lr-main').first();
  await first.focus();
  const answer = feed(page).getByRole('button', { name: 'Answer: Deploy the site' });
  await expect(answer).toHaveCSS('opacity', '1');
  await expect(feed(page).locator('.why-r').first()).toBeHidden();
  await answer.click();
  await expect(page.locator('.chat-title')).toHaveText('Deploy the site');
  const approval = page.getByRole('group', { name: /Run a command\?/ });
  await expect(approval).toBeInViewport();
  await expect(approval).toHaveClass(/flash/);

  await openHome(page);
  await feed(page).locator('.lrow', { hasText: 'Mock fetch' }).hover();
  await feed(page).getByRole('button', { name: 'See error: Mock fetch' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Mock fetch');
});

test('the Connect Linear or Jira line dismisses for the account and opens Tickets', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit.' } }]);
  await openHome(page);

  const hint = today(page).locator('.feed-foot');
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
  await expect(feed(page)).toBeVisible();
  await expect(today(page).locator('.feed-foot')).toHaveCount(0);
});

test('Home shows skeletons shaped like its sections while chats load', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit.' } }]);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/conversations', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/');
  const live = home(page).locator('.home-live');
  await expect(live).toHaveAttribute('aria-busy', 'true');
  await expect(
    home(page).getByRole('status').filter({ hasText: 'Loading what needs you' }),
  ).toBeAttached();
  await expect(home(page).locator('.sk-rows .lrow')).toHaveCount(4);
  await expect(home(page).locator('.hsk').first()).toBeVisible();
  release();
  await expect(feed(page).locator('.lrow')).toHaveCount(1);
  await expect(live).toHaveAttribute('aria-busy', 'false');
});

test('Running now shows the step and plan progress, and updates live', async ({ page }) => {
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

  await expect(home(page).locator('.home-summary')).toHaveText('2 agents are working.');
  await expect(today(page)).toHaveCount(0);
  const running = section(page, /^Running now/);
  await expect(running.getByRole('heading', { level: 2 })).toHaveText('Running now 2');
  const card = running.locator('.hcard', { hasText: 'Filter chips overflow' });
  await expect(card).toContainText('Reading FilterBar.tsx');
  await expect(card.getByRole('progressbar', { name: 'Plan progress' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await expect(
    running.locator('.hcard', { hasText: 'Worktree cleanup' }).getByRole('progressbar'),
  ).toHaveAccessibleName('Progress, no plan yet');

  await setRun(runningId!, 'succeeded');
  await expect(feed(page).locator('.lrow', { hasText: 'Filter chips overflow' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(running.locator('.hcard')).toHaveCount(1);

  await running.getByRole('button', { name: 'Watch: Worktree cleanup' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Worktree cleanup');
});

test('the spend card splits today by provider, Jev included', async ({ page }) => {
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

  const spend = section(page, 'Spend');
  await expect(spend.locator('.cost-total')).toContainText('$0.73');
  await expect(spend.locator('.cost-total')).toContainText('includes estimates');
  await expect(spend.locator('.cost-total')).toContainText('3 runs · 285K tokens');
  const legend = spend.getByRole('list', { name: 'Cost by provider' });
  await expect(legend.getByRole('listitem')).toHaveText([
    'Claude$0.64',
    'Codex~$0.08estimated',
    'Jev~$0.004estimated',
  ]);
  await expect(spend).not.toContainText('routing saved');

  await spend.getByRole('radio', { name: 'This week' }).click();
  await expect(spend.getByRole('radio', { name: 'This week' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(spend.locator('.cost-total')).toContainText('$0.73');

  await spend.getByRole('button', { name: 'Open usage and audit' }).click();
  await expect(page.getByRole('dialog', { name: 'Usage' })).toBeVisible();
});

test('the provider strip shows status, model labels, problems and a fix link', async ({ page }) => {
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

  const strip = home(page).getByRole('list', { name: 'AI providers' });
  await expect(strip.getByRole('button')).toHaveCount(4);
  await expect(
    strip.getByRole('button', { name: /^Claude · Fake Fast · Needs attention · Verify failed$/ }),
  ).toBeVisible();
  await expect(
    strip.getByRole('button', { name: /^Codex · .* · Rate limited · just now$/ }),
  ).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Z.ai (GLM) · Not connected' })).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Jev · jev-latest · Connected' })).toBeVisible();
  await expect(home(page).locator('.ps-mark.warn')).toHaveCount(2);
  await expect(home(page).locator('.ps-mark.off')).toHaveCount(1);

  const warning = home(page).locator('.ps-warn');
  await expect(warning).toContainText('Claude: Verify failed (+1 more)');
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

  await strip.getByRole('button', { name: 'Z.ai (GLM) · Not connected' }).click();
  await expect(providers.getByRole('region', { name: 'Z.ai (GLM)' })).toBeVisible();
});

test('a tooltip near the right edge stays inside the viewport', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'], jev: true });
  await page.setViewportSize({ width: 700, height: 700 });
  await openHome(page);
  const last = home(page).getByRole('list', { name: 'AI providers' }).getByRole('button').last();
  await last.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(700 - 8);
});

test('Home fits a phone screen without sideways scrolling', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const title = 'A very long chat title that keeps going well past the edge of a phone screen';
  await seedChats([
    { title: 'Stopped', run: { status: 'failed', error: 'Rate limit reached.' } },
    { title, minutesAgo: 30 },
  ]);
  await page.setViewportSize({ width: 360, height: 780 });
  await openHome(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await home(page).locator('.home-compose .composer').boundingBox();
  expect(box?.x).toBe(16);
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(344);
  const row = section(page, 'Recent chats').getByRole('button', { name: new RegExp(title) });
  await expect(row).toHaveAttribute('title', title);
  await expect(row.locator('.k')).toHaveText('30m ago');
  const clipped = await row.locator('.t').evaluate((element) => ({
    ellipsis: getComputedStyle(element).textOverflow,
    overflowing: element.scrollWidth > element.clientWidth,
    inside: element.getBoundingClientRect().right <= document.documentElement.clientWidth,
  }));
  expect(clipped).toEqual({ ellipsis: 'ellipsis', overflowing: true, inside: true });
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
    const providers = section(page, 'Spend');
    await expect(providers).not.toBeInViewport();
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    for (let turn = 0; turn < 12; turn += 1) await page.mouse.wheel(0, 600);
    await expect(providers).toBeInViewport();
  });
}
