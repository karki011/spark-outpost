import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-${name}.png`),
    clip: { x: 340, y: 0, width: 600, height: 380 },
  });
}

async function fakeNonNotchDesktop(page: Page) {
  await page.addInitScript(() => {
    const now = new Date();
    localStorage.setItem(
      'spark-outpost.island',
      JSON.stringify({
        lastSeen: now.getTime(),
        greetedDay: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`,
      }),
    );
    const focus: boolean[] = [];
    const rest: unknown[] = [];
    const none = () => () => undefined;
    Object.assign(window, {
      islandFocus: focus,
      islandRest: rest,
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: none },
        island: {
          geometry: async () => ({
            notch: false,
            top: 24,
            notchWidth: 0,
            docked: true,
            menuBar: 24,
          }),
          onGeometry: none,
          onCommand: none,
          sparkFocused: async () => false,
          onSparkFocus: none,
          onEscape: (callback: () => void) => {
            Object.assign(window, { islandEscape: callback });
            return () => undefined;
          },
          setInteractive: () => undefined,
          setFocusable: (on: boolean) => focus.push(on),
          drag: () => undefined,
          openChat: () => undefined,
          setRestSize: (size: unknown) => rest.push(size),
        },
        onOpenChat: none,
      },
    });
  });
}

async function openIsland(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

async function hoverIsland(page: Page) {
  await page.mouse.move(640, 300);
  await page.mouse.move(640, 8, { steps: 4 });
  await expect(island(page)).toHaveAttribute('data-view', /pill|card/);
}

test('stays at rest while work runs and finishes, nudges for approvals, and lists it all on hover', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await shot(page, 'peek');

  const [running] = await seedChats([{ title: 'Fix image uploads', run: { status: 'running' } }]);
  await decorateLatestRun(running!, {
    provider: 'claude',
    step: 'Editing upload.ts',
    costUsd: 0.18,
  });
  const scout = island(page).locator('.isl-scout-wrap svg.scout');
  await expect(scout).toHaveClass(/\bworking\b/);
  await page.waitForTimeout(1500);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await shot(page, 'working');

  await hoverIsland(page);
  const runningList = island(page).getByRole('region', { name: 'Running' });
  await expect(runningList).toContainText('Fix image uploads');
  await expect(runningList).toContainText('editing upload.ts');
  await page.mouse.move(640, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');

  await seedChats([
    {
      title: 'Add the image library',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'npm install sharp', command: 'npm install sharp' },
    },
  ]);
  await expect(island(page)).toHaveAttribute('data-view', 'nudge');
  await expect(island(page)).toContainText('Approve: run npm install sharp');
  await shot(page, 'nudge');
  await hoverIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  const card = island(page).getByRole('group', {
    name: /wants to run a command: npm install sharp/,
  });
  await expect(card).toContainText('npm install sharp');
  const allow = card.getByRole('button', { name: /Allow once/ });
  await expect(allow).toBeDisabled();
  await expect(allow).toBeEnabled();
  await shot(page, 'approval');
  await allow.click();
  await expect(island(page)).toContainText('Allowed once');
  await expect
    .poll(async () => (await sql(`SELECT status FROM approvals`)).rows[0]?.status)
    .toBe('allowed');

  await sql(`UPDATE runs SET status = 'running' WHERE status = 'awaiting_approval'`);
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await sql(
    `UPDATE runs SET status = 'succeeded', finished_at = now() WHERE conversation_id = $1`,
    [running],
  );
  await expect(scout).toHaveClass(/\bhappy\b/);
  await page.waitForTimeout(1000);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await shot(page, 'done');

  await hoverIsland(page);
  const recent = island(page).getByRole('region', { name: 'Recent' });
  await expect(recent).toContainText('Fix image uploads');
  await expect(recent).toContainText(/all finished/);
  const popup = page.waitForEvent('popup');
  await recent.getByRole('button', { name: /Fix image uploads/ }).click();
  await (await popup).close();
  await expect(island(page)).toHaveAttribute('data-view', 'note');
  const note = island(page).getByRole('status').filter({ hasText: 'Opening Spark…' });
  await expect(note).toBeVisible();
  await page.waitForTimeout(700);
  const scoutBox = (await island(page).locator('.isl-scout-wrap').boundingBox())!;
  for (const text of [note.locator('.isl-ttl'), note.locator('.isl-hint')]) {
    expect((await text.boundingBox())!.x).toBeGreaterThan(scoutBox.x + scoutBox.width);
  }
  const noteBox = (await note.boundingBox())!;
  const islandBox = (await island(page).boundingBox())!;
  expect(noteBox.y + noteBox.height).toBeLessThan(islandBox.y + islandBox.height);
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek', { timeout: 3000 });
});

test('the approval card takes Y only once focused', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm rotate', command: 'pnpm rotate' },
    },
  ]);
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'nudge');
  await page.keyboard.press('y');
  await expect(island(page)).toHaveAttribute('data-view', 'nudge');
  await page.keyboard.press('Alt+Space');
  const card = island(page).getByRole('group', { name: /pnpm rotate/ });
  await expect(card).toBeFocused();
  await expect(card.getByRole('button', { name: /Allow once/ })).toBeEnabled();
  await page.keyboard.press('n');
  await expect(island(page)).toContainText('Denied');
  await expect
    .poll(async () => (await sql(`SELECT status FROM approvals`)).rows[0]?.status)
    .toBe('denied');
});

test('quick chat starts a real chat with the project and autonomy chips', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openIsland(page);
  await page.keyboard.press('Alt+Space');
  const message = island(page).getByRole('textbox', { name: 'Message' });
  await expect(message).toBeFocused();
  await expect(island(page).getByRole('tab', { name: 'New chat' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await island(page).getByRole('button', { name: 'Spark autonomy: Automatic' }).click();
  await expect(
    island(page).getByRole('button', { name: 'Spark autonomy: Full auto → PR' }),
  ).toBeVisible();
  await message.fill('Where do we resize uploaded images?');
  await shot(page, 'quick');
  await page.keyboard.press('Enter');
  await expect(message).toHaveCount(0);
  await expect
    .poll(async () =>
      (await sql(`SELECT content FROM messages WHERE role = 'user'`)).rows.map(
        (row) => row.content,
      ),
    )
    .toContain('Where do we resize uploaded images?');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(island(page).locator('.isl-scout-wrap svg.scout')).toHaveClass(/\bhappy\b/, {
    timeout: 20_000,
  });
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await hoverIsland(page);
  await expect(island(page).getByRole('region', { name: 'Recent' })).toContainText(
    'Where do we resize uploaded images?',
  );
  await shot(page, 'reply');
});

test('sessions search, open one and ask for an update without touching the agent', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const ids = await seedChats([
    { title: 'Fix image uploads', run: { status: 'running' } },
    { title: 'Add dark mode toggle', run: { status: 'succeeded' } },
    { title: 'Upload size limit', run: { status: 'succeeded' } },
  ]);
  await decorateLatestRun(ids[0]!, { provider: 'claude', step: 'Editing upload.ts' });
  await openIsland(page);
  await page.keyboard.press('Alt+Shift+Space');
  const search = island(page).getByRole('combobox', { name: 'Search sessions' });
  await expect(search).toBeFocused();
  await search.fill('upload');
  const list = island(page).getByRole('listbox', { name: 'Recent sessions' });
  await expect(list.getByRole('option')).toHaveCount(2);
  await shot(page, 'sessions');
  await page.keyboard.press('Enter');
  await expect(island(page)).toContainText('Fix image uploads');
  const before = (await sql(`SELECT count(*)::int AS n FROM run_events`)).rows[0]!.n;
  await island(page).getByRole('button', { name: 'Ask for update' }).click();
  const update = island(page).getByRole('status').filter({ hasText: 'Next:' });
  await expect(update).toContainText('Editing upload.ts'.toLowerCase());
  await shot(page, 'update');
  expect((await sql(`SELECT count(*)::int AS n FROM run_events`)).rows[0]!.n).toBe(before);
  await island(page).getByRole('button', { name: 'Back to sessions' }).click();
  await expect(search).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('button', { name: 'Back to sessions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('Ask answers instantly from Spark’s own state', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await openIsland(page);
  await page.keyboard.press('Alt+Shift+Space');
  await page.keyboard.press('Meta+3');
  const ask = island(page).getByRole('textbox', { name: 'Ask Spark' });
  await expect(ask).toBeFocused();
  await ask.fill('Does anyone need anything?');
  await page.keyboard.press('Enter');
  await expect(island(page)).toContainText('1 chat needs you: “Deploy the site”.');
  await expect(island(page).getByRole('button', { name: 'Open “Deploy the site”' })).toBeVisible();
  await shot(page, 'ask');
  await expect
    .poll(async () => (await sql(`SELECT count(*)::int AS n FROM messages`)).rows[0]!.n)
    .toBe(1);

  await ask.fill('Which provider did the most work this week?');
  await page.keyboard.press('Enter');
  await expect(island(page).locator('.isl-ask-a')).toHaveCount(2, { timeout: 20_000 });
  const { rows } = await sql(
    `SELECT c.title, r.provider FROM runs r JOIN conversations c ON c.id = r.conversation_id
     JOIN profiles p ON p.assistant_conversation_id = c.id`,
  );
  expect(rows).toEqual([{ title: 'Ask Spark', provider: 'claude' }]);
});

test('active chats peek out beside Scout and hide while one is open', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Fix image uploads', run: { status: 'succeeded' } },
    { title: 'Add dark mode toggle', run: { status: 'succeeded' } },
  ]);
  await openIsland(page);
  const row = page.getByRole('toolbar', { name: 'Active chats' });
  await expect(row.getByRole('button', { name: /^Chat: / })).toHaveCount(2);
  await seedChats([{ title: 'Speed up cold start', run: { status: 'succeeded' } }]);
  await expect(row.getByRole('button', { name: /^Chat: / })).toHaveCount(3);
  await shot(page, 'peek-row');

  await row.getByRole('button', { name: 'Chat: Add dark mode toggle, done' }).click();
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page)).toContainText('Add dark mode toggle');
  await expect(row).not.toHaveAttribute('data-shown');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', /peek|pill/);
  await expect(row).toHaveAttribute('data-shown', 'true');
  const first = row.getByRole('button', { name: /^Chat: / }).first();
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(row.getByRole('button', { name: /^Chat: / }).nth(1)).toBeFocused();
});

test('the island has no serious accessibility problems in its main views', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'nudge');
  const views: string[] = [];
  const check = async (name: string) => {
    await page.waitForTimeout(700);
    const results = await new AxeBuilder({ page }).include('.isl-root').analyze();
    for (const violation of results.violations) {
      if (violation.impact === 'serious' || violation.impact === 'critical') {
        views.push(
          `${name}: ${violation.id} ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.any.map((check) => check.message).join(';')}`).join(' | ')}`,
        );
      }
    }
  };
  await check('nudge');
  await hoverIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await check('card');
  await page.keyboard.press('Escape');
  await hoverIsland(page);
  await check('hover list');
  await page.keyboard.press('Alt+Shift+Space');
  await check('sessions');
  await page.keyboard.press('Meta+1');
  await check('quick chat');
  await page.keyboard.press('Meta+3');
  await check('ask');
  expect(views).toEqual([]);
});

test('without a notch the blob peeks on its own and the pill opens a focused chat', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix image uploads', run: { status: 'succeeded' } }]);
  await fakeNonNotchDesktop(page);
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(island(page)).toHaveClass(/\bbare\b/);
  await expect
    .poll(() => island(page).evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe('rgba(0, 0, 0, 0)');

  const scout = island(page).locator('.isl-scout-wrap');
  await expect.poll(async () => (await scout.boundingBox())!.y).toBe(-20);
  expect((await scout.boundingBox())!.height).toBe(38);
  const eyes = await island(page)
    .locator('.sc-eye')
    .evaluateAll((all) => all.map((eye) => eye.getBoundingClientRect()));
  expect(Math.min(...eyes.map((eye) => eye.top))).toBeGreaterThanOrEqual(0);
  expect(Math.max(...eyes.map((eye) => eye.bottom))).toBeLessThanOrEqual(24);
  const lastRest = () =>
    page.evaluate(() => (window as unknown as { islandRest: unknown[] }).islandRest.at(-1));
  await expect.poll(lastRest).not.toBeNull();
  const rest = (await lastRest()) as { width: number; height: number };
  expect(rest.width).toBeLessThan(200);
  expect(rest.height).toBeLessThan(50);
  const blob = page.getByRole('button', { name: /^Chat: Fix image uploads/ });
  await expect.poll(async () => (await blob.boundingBox())?.y).toBe(-10);
  expect((await blob.boundingBox())!.height).toBe(28);
  const blobEyes = await blob
    .locator('.mo-eyes')
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(blobEyes).toBeGreaterThanOrEqual(0);
  expect(blobEyes).toBeLessThan(24);
  const spot = (await blob.boundingBox())!;
  await page.mouse.move(spot.x + spot.width / 2, 8);
  await page.waitForTimeout(400);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');

  const box = (await island(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, 10);
  await expect(island(page)).toHaveAttribute('data-view', 'pill');
  await expect(island(page)).not.toHaveClass(/\bbare\b/);
  await expect.poll(lastRest).toBeNull();
  expect((await island(page).boundingBox())!.y).toBe(0);
  const pill = island(page).getByRole('button', { name: 'New chat' });
  await expect(pill).toHaveCSS('cursor', 'pointer');
  const recent = island(page).getByRole('region', { name: 'Recent' });
  await expect(recent.getByRole('button')).toHaveCount(1);
  await expect(recent).toContainText('Fix image uploads');
  await expect(recent).toContainText('done');
  await pill.hover();
  await expect(pill).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await pill.click();

  const message = island(page).getByRole('textbox', { name: 'Message' });
  await expect(message).toBeFocused();
  const lastFocus = () =>
    page.evaluate(() => (window as unknown as { islandFocus: boolean[] }).islandFocus.at(-1));
  expect(await lastFocus()).toBe(true);
  const hint = island(page).locator('.isl-khint');
  await expect(hint).toContainText('new line');
  const lines = await hint.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      line: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4,
      fits: element.scrollWidth <= element.clientWidth,
    };
  });
  expect(lines.height).toBeLessThan(lines.line * 1.5);
  expect(lines.fits).toBe(true);
  await page.keyboard.press('Escape');
  await expect(message).toHaveCount(0);
  await expect.poll(lastFocus).toBe(false);

  await page.mouse.move(box.x + box.width / 2, 300);
  await page.mouse.move(box.x + box.width / 2, 10, { steps: 4 });
  await island(page).getByRole('button', { name: 'New chat' }).click();
  await expect(message).toBeFocused();
  await message.fill('Keep this draft');
  await message.blur();
  await page.evaluate(() => (window as unknown as { islandEscape: () => void }).islandEscape());
  await expect(message).toHaveCount(0);
  await expect.poll(lastFocus).toBe(false);
});
