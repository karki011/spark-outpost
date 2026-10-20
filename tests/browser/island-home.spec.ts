import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import {
  fakeHomeDesktop,
  fakeState,
  island,
  needsYou,
  openHome,
  openIsland,
  shot,
} from './island-home-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

const section = (page: Page, name: RegExp | string) => island(page).getByRole('region', { name });

async function seedInbox() {
  return seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
      minutesAgo: 6,
    },
    { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 2 },
    { title: 'Tidy the README', run: { status: 'succeeded' }, unread: true, minutesAgo: 1 },
    {
      title: 'Telemetry ingest',
      run: { status: 'failed', error: 'terminal exited' },
      unread: true,
      minutesAgo: 3,
    },
  ]);
}

test('the inbox puts what needs you first, then what runs, then what finished', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedInbox();
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);

  await expect(island(page).getByRole('status').filter({ hasText: 'need you' })).toHaveText(
    '1 need you1 running',
  );
  const card = needsYou(page).getByRole('listitem').first();
  await expect(card).toContainText('Deploy the site');
  await expect(card).toContainText('Run pnpm deploy');
  await expect(card.getByRole('button', { name: /^Allow/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Deny/ })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Later' })).toBeVisible();
  await expect(section(page, /^Running/)).toContainText('Fix billing totals');
  await expect(section(page, 'Finished').getByRole('listitem')).toHaveText([
    /Telemetry ingest · failed: terminal exited/,
    /Tidy the README · done/,
  ]);
  await expect(island(page).getByRole('button', { name: 'Open Spark', exact: true })).toBeVisible();
  await expect(island(page)).toContainText('Click a row to open it in Spark');
  await shot(page, 'inbox');
  expect((await fakeState(page)).openedChats).toEqual([]);
});

test('Allow, Later and ✕ act in place and keep the island open; a row opens Spark on that chat', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [deploy, billing, readme] = await seedInbox();
  await seedChats([
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm rotate', command: 'pnpm rotate' },
      minutesAgo: 5,
    },
  ]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);

  const deployCard = needsYou(page).getByRole('listitem').filter({ hasText: 'Deploy the site' });
  await deployCard.getByRole('button', { name: /^Allow/ }).click();
  await expect(deployCard).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sql('SELECT status FROM approvals WHERE status = $1', ['allowed'])).rowCount,
    )
    .toBe(1);

  const rotate = needsYou(page).getByRole('listitem').filter({ hasText: 'Rotate the keys' });
  await rotate.getByRole('button', { name: 'Later' }).click();
  await expect(needsYou(page).getByRole('listitem').filter({ hasText: 'set aside' })).toContainText(
    'Rotate the keys',
  );

  await section(page, 'Finished').getByRole('button', { name: 'Clear Tidy the README' }).click();
  await expect(section(page, 'Finished')).not.toContainText('Tidy the README');
  await expect
    .poll(
      async () =>
        (await sql('SELECT seen_at FROM conversations WHERE id = $1', [readme])).rows[0]?.seen_at,
    )
    .not.toBeNull();

  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  expect((await fakeState(page)).openedChats).toEqual([]);

  await section(page, /^Running/)
    .getByRole('button', { name: /^Fix billing totals/ })
    .click();
  await expect.poll(async () => (await fakeState(page)).openedChats).toEqual([billing]);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await expect(island(page)).not.toContainText('Opening Spark');
  expect(deploy).toBeTruthy();
});

test('Y answers the top request once, and ⌘O opens Spark without a chat', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedInbox();
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const allow = needsYou(page).getByRole('button', { name: /^Allow/ });
  await expect(allow).toBeEnabled();
  await expect(allow.locator('.isl-k')).toHaveText('Y');
  await page.keyboard.press('y');
  await expect(needsYou(page)).toContainText('Nothing needs you');
  await expect
    .poll(async () => (await sql("SELECT 1 FROM approvals WHERE status = 'allowed'")).rowCount)
    .toBe(1);
  await page.keyboard.press('Meta+o');
  await expect.poll(async () => (await fakeState(page)).openedChats).toEqual([null]);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('a plan or question that needs typing offers Answer in Spark', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [plan] = await seedChats([
    {
      title: 'pipeline-poc',
      run: { status: 'awaiting_approval' },
      approval: {
        kind: 'other',
        title: 'Review the plan',
        plan: 'Deploy #353 to alfa now, or wait for review?',
      },
    },
  ]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const card = needsYou(page).getByRole('listitem').filter({ hasText: 'pipeline-poc' });
  await expect(card.getByRole('button', { name: /^Allow/ })).toHaveCount(0);
  await card.getByRole('button', { name: 'Answer in Spark' }).click();
  await expect.poll(async () => (await fakeState(page)).openedChats).toEqual([plan]);
});

test('an empty inbox says nothing needs you, and New chat, Ask, Sparks and settings stay reachable', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await expect(needsYou(page)).toContainText('Nothing needs you');
  await expect(section(page, /^Running/)).toHaveCount(0);
  await expect(section(page, 'Finished')).toHaveCount(0);
  await shot(page, 'inbox-empty');

  await island(page).getByRole('button', { name: 'New chat' }).click();
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toBeFocused();
  await island(page).getByRole('button', { name: 'Ask Spark', exact: true }).click();
  await expect(island(page).getByRole('textbox', { name: 'Ask Spark' })).toBeFocused();
  await page.keyboard.press('Meta+2');
  await island(page).getByRole('region', { name: 'Your Sparks' }).getByText('New Spark').click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new']);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');

  await openHome(page);
  await island(page).getByRole('button', { name: 'Spark Island settings' }).click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new', 'island']);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('⌘1–3 switch panels, Back returns to the inbox, Escape closes, nothing auto-expands', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix image uploads', run: { status: 'succeeded' } }]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await page.keyboard.press('Meta+2');
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toBeFocused();
  await page.keyboard.press('Meta+3');
  await expect(island(page).getByRole('textbox', { name: 'Ask Spark' })).toBeFocused();
  await island(page).getByRole('button', { name: 'Back to the inbox' }).click();
  await expect(needsYou(page)).toBeVisible();
  await page.keyboard.press('Meta+2');
  await page.keyboard.press('Meta+1');
  await expect(needsYou(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');

  await openHome(page);
  await page.evaluate(() => (window as unknown as { islandEscape: () => void }).islandEscape());
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');

  await page.mouse.move(640, 600);
  await seedChats([
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm rotate', command: 'pnpm rotate' },
    },
  ]);
  await expect(island(page).getByRole('button', { name: /1 need you/ })).toBeAttached();
  await page.waitForTimeout(1500);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('the chime toggle persists and chimes only when it is on', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const chimes = island(page).getByRole('button', { name: 'Island chimes' });
  await expect(chimes).toHaveAttribute('aria-pressed', 'false');
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await expect(island(page).getByText('1 need you')).toBeVisible();
  expect((await fakeState(page)).chimes).toBe(0);

  await chimes.click();
  await expect(chimes).toHaveAttribute('aria-pressed', 'true');
  expect((await fakeState(page)).sound).toEqual([true]);
  await page.reload();
  await openHome(page);
  await expect(island(page).getByRole('button', { name: 'Island chimes' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await seedChats([
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Rotate', command: 'pnpm rotate' },
    },
  ]);
  await expect(island(page).getByText('2 need you')).toBeVisible();
  await expect.poll(async () => (await fakeState(page)).chimes).toBeGreaterThan(0);
});

test('reduced motion opens the inbox in place with no movement', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix image uploads', run: { status: 'running' } }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await expect(section(page, /^Running/)).toContainText('Fix image uploads');
  const moving = await island(page).evaluate((root) =>
    root
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running')
      .map((animation) => (animation as CSSAnimation).animationName ?? 'script'),
  );
  expect(moving).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(island(page).locator('.isl-ghost')).toHaveCount(0);
});

test('a Spark tile in New chat starts a follow-up with that Spark right in the island', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeHomeDesktop(page);
  await openIsland(page);
  for (const [name, color] of [
    ['Stripe', 'sky'],
    ['GitHub', 'rose'],
  ]) {
    const response = await page.request.post('/api/teammates', {
      data: { name, role: 'Helper', face: { shape: 'boxy', color } },
    });
    expect(response.status()).toBe(201);
  }
  await openHome(page);
  await island(page).getByRole('button', { name: 'New chat' }).click();
  const tiles = island(page).getByRole('region', { name: 'Your Sparks' }).getByRole('button');
  await expect(tiles).toHaveCount(3);
  await tiles.last().click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new']);
  await openHome(page);
  await island(page).getByRole('button', { name: 'New chat' }).click();
  await tiles.filter({ hasText: 'GitHub' }).click();
  await expect(island(page)).toContainText('Following up in GitHub');
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toHaveAttribute(
    'placeholder',
    'Reply…',
  );
  expect((await fakeState(page)).openedChats).toEqual([]);
});

test('Review on a force-push card leaves the inbox for the full card', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Rewrite the release branch',
      run: { status: 'awaiting_approval' },
      approval: {
        kind: 'execute',
        title: 'git push --force',
        command: 'git push --force origin spark/release',
        payload: { forcePush: ['spark/release'] },
      },
    },
  ]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);

  const card = needsYou(page).getByRole('listitem').first();
  await expect(card).toContainText('Force-push');
  await card.getByRole('button', { name: 'Review' }).click();
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await expect(island(page)).toContainText('Rewrites history on spark/release');
});

const NIGHT_SKINS = ['graphite', 'void', 'moss', 'plum', 'aurora'];

for (const theme of ['apricot', 'graphite']) {
  test(`in the ${theme} app theme the inbox is night glass with no accessibility problems`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await resetTestDatabase({ onboarded: true });
    await seedInbox();
    await fakeHomeDesktop(page, theme);
    await openIsland(page);
    await openHome(page);
    expect(NIGHT_SKINS).toContain(await page.evaluate(() => document.documentElement.dataset.skin));
    const problems: string[] = [];
    const check = async (view: string) => {
      await page.waitForTimeout(800);
      const results = await new AxeBuilder({ page }).include('.isl-root').analyze();
      for (const violation of results.violations) {
        if (violation.impact !== 'serious' && violation.impact !== 'critical') continue;
        problems.push(
          `${view}: ${violation.id} ${violation.nodes.map((node) => node.target).join(' ')}`,
        );
      }
    };
    await check('inbox');
    await shot(page, `inbox-${theme}`, 0);
    await page.keyboard.press('Meta+2');
    await check('new');
    await page.keyboard.press('Meta+3');
    await check('ask');
    expect(problems).toEqual([]);
  });
}
