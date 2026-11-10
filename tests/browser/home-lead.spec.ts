import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const lead = (page: Page, name: string | RegExp) => home(page).getByRole('region', { name });
const composer = (page: Page) => home(page).getByRole('region', { name: 'Start a new chat' });

async function seedAway() {
  await seedChats([
    { title: 'Current chat' },
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' }, unread: true },
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
}

async function backHome(page: Page) {
  const rail = page.getByRole('navigation', { name: 'Main' });
  await rail.getByRole('button', { name: /^Chats/ }).click();
  await rail.getByRole('button', { name: /^Home/ }).click();
  await expect(home(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 10, 11, 0, 0));
  await resetTestDatabase({ onboarded: true });
});

test('Since you left puts failed first, then the waiting card, then finished turns', async ({
  page,
}) => {
  await seedAway();
  await page.goto('/');

  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(
    'Good morning, Test. 2 updates landed while you were away, 1 stopped with an error.',
  );
  const since = lead(page, 'Since you left');
  await expect(since.getByRole('heading', { level: 2 })).toHaveText('Since you left');
  await expect(since.locator('.hrow-m b')).toHaveText([
    'Mock fetch',
    'Deploy the site',
    'Ship the notes',
  ]);
  await expect(since.locator('.hrow-m small')).toHaveText([
    'Stopped: rate limit reached',
    'Fake provider wants to run pnpm deploy',
    'Finished · open to review',
  ]);
  await expect(since.locator('.hstat')).toHaveText(['Failed', 'Waiting', 'Finished']);
  await expect(since.getByRole('button')).toHaveText(['See error', 'Open chat', 'Review']);
  await expect(home(page).locator('.home-compose')).toHaveClass(/compact/);
  await expect(lead(page, /^Needs you/)).toHaveCount(0);
  await expect(lead(page, 'Pick up next')).toBeVisible();
});

test('opening a Since you left row reads it and removes it', async ({ page }) => {
  await seedAway();
  await page.goto('/');
  const since = lead(page, 'Since you left');
  await since.getByRole('button', { name: 'Review: Ship the notes' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Ship the notes');

  await backHome(page);
  await expect(home(page).getByText('Ship the notes')).toHaveCount(0);
  const items = (await (await page.request.get('/api/attention')).json()) as {
    items: { kind: string; conversationId: string }[];
  };
  expect(items.items.filter((item) => item.kind === 'run-done')).toEqual([]);
});

test('Since you left shows five rows and a line for the rest', async ({ page }) => {
  await seedChats(
    Array.from({ length: 7 }, (_, index) => ({
      title: `Stopped chat ${index + 1}`,
      run: { status: 'failed', error: 'Rate limit reached.' },
      unread: true,
    })),
  );
  await page.goto('/');
  const since = lead(page, 'Since you left');
  await expect(since.locator('.hrow')).toHaveCount(5);
  await expect(since.getByRole('button', { name: /^2 more · Open / })).toBeVisible();
  await expect(lead(page, /^Needs you/).locator('.hrow')).toHaveCount(2);
});

test('the board has no lead when nothing is waiting, and the composer is its lead', async ({
  page,
}) => {
  await seedChats([{ title: 'Filter chips overflow', run: { status: 'running' } }]);
  await page.goto('/');
  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(
    'Good morning, Test. 1 agent is working.',
  );
  await expect(home(page).locator('.home-lead')).toBeEmpty();
  await expect(home(page).locator('.home-compose')).not.toHaveClass(/compact/);
  await expect(home(page).locator('.home-board').getByRole('heading', { level: 2 })).toContainText([
    'Pick up next',
    'Working',
  ]);
});

test('keyboard order runs from the lead actions through the composer to the board', async ({
  page,
}) => {
  await seedChats([
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' }, unread: true },
  ]);
  await page.goto('/');
  const since = lead(page, 'Since you left');
  await since.getByRole('button', { name: 'See error: Mock fetch' }).focus();

  const seen: string[] = [];
  for (let press = 0; press < 40; press += 1) {
    const where = await page.evaluate(() => {
      const active = document.activeElement;
      if (active?.closest('.home-lead')) return 'lead';
      if (active?.closest('.home-compose')) return 'composer';
      if (active?.closest('.home-board')) return 'board';
      return 'outside';
    });
    seen.push(where);
    if (where === 'board') break;
    await page.keyboard.press('Tab');
  }
  const order = seen.filter((place, index) => place !== seen[index - 1]);
  expect(order).toEqual(['lead', 'composer', 'board']);
  expect(seen.filter((place) => place === 'lead')).toHaveLength(2);
});

test('the composer keeps its text and focus when a lead appears', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 10, 16, 58, 0) });
  await seedChats([{ title: 'Overnight refactor', run: { status: 'running' } }]);
  await page.goto('/');
  await expect(home(page).locator('.home-lead')).toBeEmpty();

  const input = composer(page).getByRole('textbox', { name: 'Message' });
  await input.click();
  await input.fill('half a thought');
  await page.clock.fastForward('03:00');

  const before = lead(page, 'Before you go');
  await expect(before).toBeVisible();
  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(
    'Before you go, 1 agent is working.',
  );
  await expect(before.getByRole('button', { name: 'Open chat: Overnight refactor' })).toBeVisible();
  await expect(input).toHaveValue('half a thought');
  await expect(input).toBeFocused();
});

test('Before you go groups running chats by agent mode without fetching chat details', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, catalog: true });
  await page.clock.setFixedTime(new Date(2026, 10, 10, 18, 0, 0));
  await seedChats([
    {
      title: 'Manual refactor',
      run: { status: 'running', provider: 'claude', agentMode: 'default' },
    },
    { title: 'Auto migration', run: { status: 'running', provider: 'claude', agentMode: 'auto' } },
  ]);
  const details: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/conversations\/[0-9a-f-]{36}(\/|$)/.test(path)) details.push(path);
  });
  await page.goto('/');

  const before = lead(page, 'Before you go');
  const asks = before.getByRole('group', { name: 'Will stop and ask' });
  const free = before.getByRole('group', { name: 'Runs without asking' });
  await expect(asks).toContainText('Manual refactor');
  await expect(asks).toContainText('Manual · will stop and ask');
  await expect(free).toContainText('Auto migration');
  await expect(free).toContainText('Auto · runs without asking');
  expect(details).toEqual([]);
});
