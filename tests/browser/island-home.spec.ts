import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import {
  fakeHomeDesktop,
  fakeState,
  island,
  nowCard,
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

async function addStep(conversationId: string, name: string, finished = false) {
  const { rows } = await sql(
    'SELECT id FROM runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
    [conversationId],
  );
  const runId = rows[0]!.id as string;
  for (const type of finished ? ['STEP_STARTED', 'STEP_FINISHED'] : ['STEP_STARTED']) {
    await sql(
      `INSERT INTO run_events (run_id, seq, type, payload)
       VALUES ($1, (SELECT COALESCE(max(seq), 0) + 1 FROM run_events WHERE run_id = $1), $2, $3)`,
      [runId, type, JSON.stringify({ type, stepName: name })],
    );
  }
}

const log = (page: Page) => nowCard(page).getByRole('list', { name: 'Latest steps' });

test('Home leads with what needs you, streams the live steps and opens a chat in place', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [billing] = await seedChats([
    { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 },
    { title: 'Tidy the README', run: { status: 'succeeded' }, minutesAgo: 0 },
  ]);
  await decorateLatestRun(billing!, {
    provider: 'claude',
    plan: ['completed', 'in_progress', 'pending', 'pending'],
  });
  await addStep(billing!, 'Read `/Users/ada/korus/src/billing.ts`', true);
  await addStep(billing!, 'Edit `src/billing.ts`');
  const [deploy] = await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
      minutesAgo: 6,
    },
  ]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);

  await expect(nowCard(page)).toHaveAccessibleName('Now: Deploy the site');
  const dots = nowCard(page).getByRole('group', { name: 'Live chats' }).getByRole('button');
  await expect(dots).toHaveCount(2);
  await shot(page, 'home-needs-you');
  await dots.nth(1).click();
  await expect(nowCard(page)).toHaveAccessibleName('Now: Fix billing totals');
  await expect(nowCard(page)).toContainText('Claude');
  await expect(nowCard(page)).toContainText('Step 2 of 4');
  await expect(log(page).getByRole('listitem')).toHaveText([
    'Done: Read · billing.ts',
    'Now: Editing · billing.ts',
  ]);
  await expect(log(page)).not.toContainText('/Users/ada');

  await addStep(billing!, '`STRIPE_KEY=sk_live_abcdefghijklmnop1234 pnpm test --filter billing`');
  await expect(log(page).getByRole('listitem')).toHaveCount(3);
  await expect(log(page).getByRole('listitem').last()).toHaveText('Now: Running · pnpm test');
  await expect(log(page)).not.toContainText('sk_live');
  await shot(page, 'home');

  await nowCard(page).getByRole('button', { name: 'Open Fix billing totals' }).click();
  await expect(island(page).getByRole('tab', { name: 'Chats' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(island(page).getByRole('button', { name: 'Back to chats' })).toBeVisible();
  await expect(island(page).getByRole('log', { name: 'Recent messages' })).toContainText(
    'Fix billing totals',
  );

  await page.keyboard.press('Meta+1');
  await nowCard(page)
    .getByRole('button', { name: 'Open Deploy the site' })
    .click({
      modifiers: ['Meta'],
    });
  await expect.poll(async () => (await fakeState(page)).openedChats).toEqual([deploy]);
});

test('Spark tiles start a chat with that Spark right in the island', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeHomeDesktop(page);
  await openIsland(page);
  for (const [name, color] of [
    ['Stripe', 'sky'],
    ['GitHub', 'rose'],
    ['n8n', 'gold'],
    ['Vercel', 'violet'],
    ['Docs', 'moss'],
  ]) {
    const response = await page.request.post('/api/teammates', {
      data: {
        name,
        role: name === 'Docs' ? 'Writes and tidies the guides nobody else reads' : 'Helper',
        face: { shape: 'boxy', color },
      },
    });
    expect(response.status()).toBe(201);
  }
  await openHome(page);
  const tiles = island(page).getByRole('region', { name: 'Your Sparks' }).getByRole('button');
  await expect(tiles).toHaveCount(6);
  await expect(tiles.first()).toHaveAccessibleName('Chat with Stripe, Helper');
  await expect(tiles.first().locator('.isl-tile-role')).toHaveText('Helper');
  await expect(tiles.last()).toHaveText('New Spark');
  const long = tiles.filter({ hasText: 'Docs' });
  await long.scrollIntoViewIfNeeded();
  const fits = await long.evaluate((tile) => {
    const role = tile.querySelector('.isl-tile-role')!;
    const box = tile.getBoundingClientRect();
    return role.scrollWidth > role.clientWidth && role.getBoundingClientRect().right <= box.right;
  });
  expect(fits).toBe(true);
  const grid = island(page).locator('.isl-tilegrid');
  expect(
    await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
  ).toBeGreaterThanOrEqual(2);
  await expect(nowCard(page)).toContainText('All quiet');
  await shot(page, 'home-sparks');

  await tiles.last().click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new']);
  await openHome(page);
  await tiles.filter({ hasText: 'Stripe' }).click({ button: 'right' });
  await expect
    .poll(async () => (await fakeState(page)).settings.at(-1))
    .toMatch(/^spark-edit:[0-9a-f-]{36}$/);
  await openHome(page);

  await tiles.filter({ hasText: 'GitHub' }).click();
  await expect(island(page).getByRole('button', { name: 'Back to chats' })).toBeVisible();
  const reply = island(page).getByRole('textbox', { name: /^Reply to/ });
  await expect(reply).toBeVisible();
  const { rows } = await sql(
    `SELECT t.name FROM conversations c JOIN teammates t ON t.id = c.teammate_id`,
  );
  expect(rows.map((row) => row.name)).toEqual(['GitHub']);
});

test('an empty Home offers Ask and quick starts, and the bar reaches settings', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await expect(nowCard(page)).toHaveAccessibleName('Now');
  const quick = island(page).getByRole('region', { name: 'Quick start' });
  await expect(quick.getByRole('button')).toHaveText(['New chat', 'Ask Spark', 'New Spark']);
  await expect(quick).toContainText('Nothing needs you');
  await shot(page, 'home-empty');

  await nowCard(page).getByRole('button', { name: 'Ask Spark…' }).click();
  await expect(island(page).getByRole('tab', { name: 'New chat' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    island(page).getByRole('button', { name: 'Ask Spark', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(island(page).getByRole('textbox', { name: 'Ask Spark' })).toBeFocused();

  await page.keyboard.press('Meta+1');
  await island(page).getByRole('region', { name: 'Quick start' }).getByText('New Spark').click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new']);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');

  await openHome(page);
  await island(page).getByRole('button', { name: 'Spark Island settings' }).click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new', 'island']);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('tabs switch with clicks and ⌘1–4, Escape always closes, and nothing auto-expands', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix image uploads', run: { status: 'succeeded' } }]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const tab = (name: string) => island(page).getByRole('tab', { name });
  await tab('Chats').click();
  await expect(tab('Chats')).toHaveAttribute('aria-selected', 'true');
  await expect(island(page).getByRole('combobox', { name: 'Search sessions' })).toBeFocused();
  await shot(page, 'chats');
  await tab('New chat').click();
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toBeFocused();
  await shot(page, 'new');
  await page.keyboard.press('Meta+4');
  await expect(island(page).getByRole('textbox', { name: 'Ask Spark' })).toBeFocused();
  await page.keyboard.press('Meta+2');
  await expect(tab('Chats')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Meta+1');
  await expect(tab('Home')).toHaveAttribute('aria-selected', 'true');
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
  await expect(island(page).getByRole('tab', { name: 'Chats, 1 need you' })).toBeVisible();
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
  await expect(island(page).getByRole('tab', { name: 'Chats, 2 need you' })).toBeVisible();
  await expect.poll(async () => (await fakeState(page)).chimes).toBeGreaterThan(0);
});

test('reduced motion opens Home in place with no movement', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix image uploads', run: { status: 'running' } }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await expect(nowCard(page)).toHaveAccessibleName('Now: Fix image uploads');
  const moving = await island(page).evaluate((root) =>
    root
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running')
      .map((animation) => (animation as CSSAnimation).animationName ?? 'script'),
  );
  expect(moving).toEqual([]);
  await expect(nowCard(page)).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(island(page).locator('.isl-ghost')).toHaveCount(0);
});

async function frame(page: Page, step: number, at: number, name: string) {
  await page.clock.runFor(Math.max(1, step));
  await page.evaluate((time) => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = time;
    }
  }, at);
  await shot(page, name, 0);
}

async function playAll(page: Page) {
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
}

test('motion: Home grows out of the blob and folds back into it', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [running] = await seedChats([{ title: 'Fix billing totals', run: { status: 'running' } }]);
  await decorateLatestRun(running!, { provider: 'claude', step: 'Read `src/billing.ts`' });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await expect(page.getByRole('button', { name: /^Chat: Fix billing totals/ })).toBeVisible();
  await page.mouse.move(640, 600);
  await page.waitForTimeout(600);
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 2_000);
  await island(page)
    .getByRole('button', { name: /Open Spark Island/ })
    .evaluate((button: HTMLElement) => button.click());
  const blob = nowCard(page).locator('.isl-now-blob');
  await expect(blob).toBeAttached();
  expect(
    await nowCard(page).evaluate((card) => card.getAnimations({ subtree: true }).length),
  ).toBeGreaterThan(0);
  let elapsed = 0;
  for (const at of [0, 70, 140, 220, 320, 480, 760]) {
    await frame(page, at - elapsed, at, `expand-${String(at).padStart(3, '0')}ms`);
    elapsed = at;
  }
  await playAll(page);
  await page.clock.runFor(1_000);
  await page.keyboard.press('Escape');
  await expect(island(page).locator('.isl-ghost')).toHaveCount(1);
  elapsed = 0;
  for (const at of [0, 80, 160, 240]) {
    await frame(page, at - elapsed, at, `collapse-${String(at).padStart(3, '0')}ms`);
    elapsed = at;
  }
  await playAll(page);
  await page.clock.resume();
  await expect(island(page).locator('.isl-ghost')).toHaveCount(0);
  await expect(island(page)).toHaveAttribute('data-view', /peek|pill/);
});

const NIGHT_SKINS = ['graphite', 'void', 'moss', 'plum', 'aurora'];

for (const theme of ['apricot', 'graphite']) {
  test(`in the ${theme} app theme the island is night glass with no accessibility problems`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await resetTestDatabase({ onboarded: true });
    const [running] = await seedChats([
      { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 },
      {
        title: 'Deploy the site',
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
        minutesAgo: 4,
      },
    ]);
    await decorateLatestRun(running!, {
      provider: 'claude',
      plan: ['completed', 'in_progress', 'pending'],
    });
    await addStep(running!, 'Read `src/billing.ts`', true);
    await addStep(running!, 'Edit `src/invoice.ts`');
    await fakeHomeDesktop(page, theme);
    await openIsland(page);
    for (const [name, color] of [
      ['Stripe', 'sky'],
      ['GitHub', 'rose'],
      ['n8n', 'gold'],
      ['Vercel', 'violet'],
    ]) {
      await page.request.post('/api/teammates', {
        data: { name, role: 'Helper', face: { shape: 'boxy', color } },
      });
    }
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
    await nowCard(page).getByRole('button', { name: 'Show Fix billing totals' }).click();
    await expect(nowCard(page)).toContainText('Editing · invoice.ts');
    await check('home');
    await shot(page, `home-${theme}`, 0);
    await page.keyboard.press('Meta+2');
    await check('chats');
    await shot(page, `chats-${theme}`, 0);
    await page.keyboard.press('Meta+3');
    await check('new');
    await shot(page, `new-${theme}`, 0);
    await page.keyboard.press('Meta+4');
    await check('ask');
    await shot(page, `ask-${theme}`, 0);
    expect(problems).toEqual([]);
  });
}
