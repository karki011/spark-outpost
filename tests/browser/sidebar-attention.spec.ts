import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats, type SeedApproval } from './sidebar-seed.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.WAIT_SHOTS ?? '';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const row = (page: Page, title: string) =>
  sidebar(page).getByRole('listitem').filter({ hasText: title });

const LONG_MESSAGE = Array.from(
  { length: 60 },
  (_, index) => `Line ${index + 1} of the brief.`,
).join('\n\n');

const runTests: SeedApproval = { kind: 'execute', title: 'Run tests', command: 'pnpm test' };
const editFormat: SeedApproval = {
  kind: 'edit',
  title: 'Edit format.ts',
  paths: ['/work/app/src/format.ts'],
};
const question: SeedApproval = {
  kind: 'clarify',
  title: 'How should this be handled?',
  checkpoint: { kind: 'clarify', question: 'How should this be handled?', reason: 'Unclear.' },
};

async function shot(page: Page, skin: string) {
  if (!SHOTS) return;
  await page.evaluate((value) => {
    document.documentElement.dataset.skin = value;
    document.documentElement.dataset.scrollbars = 'classic';
  }, skin);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/wait-${skin}.png` });
}

test('rows say whether a chat wants permission, input, or a review', async ({ page }) => {
  await seedChats([
    { title: 'Current chat' },
    { title: 'Run the suite', run: { status: 'awaiting_approval' }, approval: runTests },
    { title: 'Tidy the formatter', run: { status: 'awaiting_approval' }, approval: editFormat },
    { title: 'Pick a heading', run: { status: 'awaiting_approval' }, approval: question },
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' } },
    ...Array.from({ length: 16 }, (_, index) => ({
      title: `Earlier chat ${index + 1}`,
      minutesAgo: 60 + index,
    })),
  ]);
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText('Current chat');

  await expect(row(page, 'Run the suite')).toHaveClass(/st-permission/);
  await expect(row(page, 'Run the suite').locator('.st .dia')).toBeVisible();
  await expect(row(page, 'Run the suite').locator('.sub')).toHaveText(
    'Fake provider wants to run pnpm test',
  );
  await expect(row(page, 'Tidy the formatter').locator('.sub')).toHaveText(
    'Fake provider wants to edit format.ts',
  );
  await expect(row(page, 'Pick a heading')).toHaveClass(/st-asking/);
  await expect(row(page, 'Pick a heading').locator('.st .ask')).toBeVisible();
  await expect(row(page, 'Pick a heading').locator('.sub')).toHaveText('Jev has a question');
  await expect(
    row(page, 'Run the suite').getByRole('img', { name: 'Asking permission' }),
  ).toBeVisible();
  await expect(
    row(page, 'Pick a heading').getByRole('img', { name: 'Needs your input' }),
  ).toBeVisible();

  await expect(row(page, 'Ship the notes')).toHaveClass(/st-done/);
  await expect(row(page, 'Ship the notes').locator('.sub')).toHaveText('Finished · open to review');
  await expect(row(page, 'Mock fetch').locator('.sub')).toHaveText('Stopped: rate limit reached');

  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByLabel('3 chats need your input'),
  ).toHaveText('3');
  await expect(page).toHaveTitle('(3) Spark Outpost');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon-waiting.svg');
  await expect(sidebar(page).getByRole('button', { name: /^3 chats need you/ })).toBeVisible();
  await shot(page, 'graphite');
  await shot(page, 'apricot');
  await shot(page, 'contrast');
});

test('the attention card jumps to the waiting card in that chat', async ({ page }) => {
  await seedChats([
    { title: 'Current chat' },
    {
      title: 'Deploy the site',
      message: LONG_MESSAGE,
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText('Current chat');
  await expect(page).toHaveTitle('(1) Spark Outpost');

  const attention = sidebar(page).getByRole('button', {
    name: 'Deploy the site needs your permission Fake provider wants to run pnpm deploy',
  });
  await attention.click();
  await expect(page.locator('.chat-title')).toHaveText('Deploy the site');
  const approval = page.getByRole('group', { name: /Run a command\?/ });
  await expect(approval).toBeInViewport();
  await expect(approval).toHaveClass(/flash/);
  await expect(attention).not.toBeVisible();
});

test('several waiting chats open into a list, and each one jumps to its chat', async ({ page }) => {
  await seedChats([
    { title: 'Current chat' },
    { title: 'Run the suite', run: { status: 'awaiting_approval' }, approval: runTests },
    { title: 'Pick a heading', run: { status: 'awaiting_approval' }, approval: question },
  ]);
  await openChats(page);
  const summary = sidebar(page).getByRole('button', { name: '2 chats need you' });
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await summary.click();
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  const list = sidebar(page).getByRole('list', { name: 'Chats waiting for you' });
  await expect(list.getByRole('button')).toHaveText([
    'Run the suite needs your permissionFake provider wants to run pnpm test',
    'Pick a heading needs your inputJev has a question',
  ]);
  await list.getByRole('button', { name: /^Pick a heading/ }).click();
  await expect(page.locator('.chat-title')).toHaveText('Pick a heading');
  await expect(
    sidebar(page).getByRole('button', {
      name: 'Run the suite needs your permission Fake provider wants to run pnpm test',
    }),
  ).toBeVisible();
});

test('each chat row shows its own blob, the same after a reload, with a face for its state', async ({
  page,
}) => {
  await seedChats([
    { title: 'Current chat' },
    { title: 'Quiet chat' },
    { title: 'Run the suite', run: { status: 'awaiting_approval' }, approval: runTests },
  ]);
  await openChats(page);
  const face = (title: string) => row(page, title).locator('.st .chat-face');
  const look = async (title: string) => ({
    drawn: await face(title)
      .locator('img, svg')
      .evaluate((blob) => blob.outerHTML),
    color: await face(title).getAttribute('data-color'),
    shape: await face(title).getAttribute('data-shape'),
  });

  await expect(face('Quiet chat')).toBeVisible();
  await expect(face('Quiet chat')).toHaveAttribute('data-expression', 'idle');
  await expect(face('Run the suite')).toHaveAttribute('data-expression', 'unsure');
  await expect(row(page, 'Run the suite').locator('.st .dia')).toBeVisible();
  const before = { quiet: await look('Quiet chat'), current: await look('Current chat') };
  expect(before.quiet.drawn).not.toBe(before.current.drawn);

  await page.reload();
  await expect(face('Quiet chat')).toBeVisible();
  expect({ quiet: await look('Quiet chat'), current: await look('Current chat') }).toEqual(before);
  const box = await face('Quiet chat').boundingBox();
  const waiting = await face('Run the suite').boundingBox();
  expect([box?.width, box?.height]).toEqual([18, 18]);
  expect([waiting?.width, waiting?.height]).toEqual([18, 18]);
});
