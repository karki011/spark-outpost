import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const section = (page: Page, name: string | RegExp) => home(page).getByRole('region', { name });
const composer = (page: Page) => home(page).getByRole('region', { name: 'Start a new chat' });

async function seedMix() {
  await seedChats([
    { title: 'Current chat' },
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' }, unread: true },
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
    { title: 'Filter chips overflow', run: { status: 'running' } },
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

test('Home is the message box, then what needs you, then the working set', async ({ page }) => {
  await seedMix();
  await page.goto('/');

  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(
    'Good morning, Test. 2 things need you and 1 agent is working.',
  );
  const needs = section(page, /^Needs you/);
  await expect(needs.locator('.hrow-m b')).toHaveText(['Deploy the site', 'Mock fetch']);
  await expect(needs.locator('.hstat')).toHaveText(['Waiting', 'Failed']);
  await expect(needs.getByRole('button', { name: 'Allow once: Deploy the site' })).toBeVisible();
  await expect(needs.getByRole('button', { name: 'Deny: Deploy the site' })).toBeVisible();

  const set = section(page, 'Working set');
  await expect(set.locator('.hrow-m b')).toHaveText(['Filter chips overflow', 'Ship the notes']);
  await expect(set.locator('.hstat')).toHaveText(['Working', 'Done']);

  const order = await home(page).evaluate((root) =>
    [...root.querySelectorAll('h1, .home-compose, .home-needs, .home-set')].map((node) =>
      node.tagName === 'H1' ? 'headline' : node.className.split(' ')[0],
    ),
  );
  expect(order).toEqual(['headline', 'home-compose', 'hcard2', 'hcard2']);
  await expect(home(page).getByText(/Pick up next|Since you left|Before you go/)).toHaveCount(0);
});

test('Needs you is left out when nothing waits', async ({ page }) => {
  await seedChats([{ title: 'Filter chips overflow', run: { status: 'running' } }]);
  await page.goto('/');
  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(
    'Good morning, Test. 1 agent is working.',
  );
  await expect(section(page, /^Needs you/)).toHaveCount(0);
  await expect(section(page, 'Working set')).toContainText('Filter chips overflow');
});

test('reviewing a finished chat reads it and takes it off the working set', async ({ page }) => {
  await seedMix();
  await page.goto('/');
  await section(page, 'Working set')
    .getByRole('button', { name: 'Review: Ship the notes' })
    .click();
  await expect(page.locator('.chat-title')).toHaveText('Ship the notes');

  await backHome(page);
  await expect(section(page, 'Working set')).toBeVisible();
  await expect(home(page).getByText('Ship the notes')).toHaveCount(0);
});

test('keyboard order runs from the message box to what needs you, then the working set', async ({
  page,
}) => {
  await seedMix();
  await page.goto('/');
  await composer(page).getByRole('textbox', { name: 'Message' }).focus();

  const seen: string[] = [];
  for (let press = 0; press < 40; press += 1) {
    const where = await page.evaluate(() => {
      const active = document.activeElement;
      if (active?.closest('.home-compose')) return 'composer';
      if (active?.closest('.home-needs')) return 'needs';
      if (active?.closest('.home-set')) return 'set';
      return 'outside';
    });
    seen.push(where);
    if (where === 'set') break;
    await page.keyboard.press('Tab');
  }
  const order = seen.filter((place, index) => place !== seen[index - 1] && place !== 'outside');
  expect(order).toEqual(['composer', 'needs', 'set']);
});

test('the message box keeps its text and focus when a card starts waiting', async ({ page }) => {
  await seedChats([{ title: 'Overnight refactor', run: { status: 'running' } }]);
  await page.goto('/');
  await expect(section(page, /^Needs you/)).toHaveCount(0);

  const input = composer(page).getByRole('textbox', { name: 'Message' });
  await input.click();
  await input.fill('half a thought');
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await expect(section(page, /^Needs you/)).toContainText('Deploy the site', { timeout: 15_000 });
  await expect(input).toHaveValue('half a thought');
  await expect(input).toBeFocused();
});
