import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import { seedChats } from './sidebar-seed.ts';
import { pointAtScout } from './island-pointer.ts';

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
  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
}

async function leaveIsland(page: Page) {
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
}

const inbox = (page: Page, name: RegExp | string) => island(page).getByRole('region', { name });

const needYou = (page: Page) => island(page).locator('.isl-pbadge');

test('stays at rest through running work and approvals; hover answers in place', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await resetTestDatabase({ onboarded: true });
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await shot(page, 'peek');

  const [running] = await seedChats([{ title: 'Fix image uploads', run: { status: 'running' } }]);
  await decorateLatestRun(running!, {
    provider: 'claude',
    step: 'Edit `src/upload.ts`',
    costUsd: 0.18,
  });
  const scout = island(page).locator('.isl-scout-wrap svg.scout');
  await expect(scout).toHaveClass(/\bworking\b/);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.waitForTimeout(1500);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await shot(page, 'working');

  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).locator('.isl-hover')).toHaveCount(0);
  await expect(inbox(page, /^Working/)).toContainText('Fix image uploads');
  await shot(page, 'home');
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');

  await seedChats([
    {
      title: 'Add the image library',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'npm install sharp', command: 'npm install sharp' },
    },
  ]);
  await expect(needYou(page)).toHaveText('1');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await shot(page, 'waiting-count');

  await pointAtScout(page);
  const hover = island(page).locator('.isl-hover');
  await expect(hover).toContainText('Add the image library');
  await expect(hover).toContainText('npm install sharp');
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await shot(page, 'hover-request');
  await hover.getByRole('button', { name: 'Allow' }).click();
  await expect
    .poll(async () => (await sql(`SELECT status FROM approvals`)).rows[0]?.status)
    .toBe('allowed');

  await page.mouse.move(5, 600);
  await sql(`UPDATE runs SET status = 'succeeded', finished_at = now()`);
  await expect(scout).toHaveClass(/\bhappy\b/);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.waitForTimeout(1000);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await shot(page, 'done');

  await hoverIsland(page);
  await expect(inbox(page, 'Nothing needs you')).toBeVisible();
  await expect(island(page)).not.toContainText('Fix image uploads');
  await leaveIsland(page);
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
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(needYou(page)).toHaveText('1');
  await page.keyboard.press('y');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(needYou(page)).toHaveText('1');
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

test('quick chat starts a real chat with the project and autonomy chips @packaged', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openIsland(page);
  await page.keyboard.press('Alt+Space');
  const message = island(page).getByRole('textbox', { name: 'Message' });
  await expect(message).toBeFocused();
  await island(page).getByRole('button', { name: 'Spark autonomy: Full auto → PR' }).click();
  await expect(
    island(page).getByRole('button', { name: 'Spark autonomy: Automatic' }),
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
  await expect(island(page).locator('.isl-scout-wrap svg.scout')).toHaveClass(/\bhappy\b/, {
    timeout: 20_000,
  });
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await hoverIsland(page);
  await expect(inbox(page, 'Nothing needs you')).toBeVisible();
  await shot(page, 'reply');
});

test('the Home shortcut opens Home, and a working tile opens that chat in Spark @packaged', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const ids = await seedChats([
    { title: 'Fix image uploads', run: { status: 'running' } },
    { title: 'Add dark mode toggle', run: { status: 'succeeded' } },
  ]);
  await decorateLatestRun(ids[0]!, { provider: 'claude', step: 'Editing upload.ts' });
  await openIsland(page);
  await page.keyboard.press('Alt+Shift+Space');
  const running = inbox(page, /^Working/);
  await expect(running.getByRole('button', { name: /^Fix image uploads/ })).toContainText(
    'Editing upload.ts',
  );
  await expect(running).not.toContainText('Add dark mode toggle');
  await shot(page, 'inbox');
  const popup = page.waitForEvent('popup');
  await running.getByRole('button', { name: /^Fix image uploads/ }).click();
  await (await popup).close();
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await page.keyboard.press('Alt+Shift+Space');
  await expect(running).toBeVisible();
  await page.keyboard.press('Alt+Shift+Space');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('Ask sends every question to the model, even one about Spark’s own state', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await openIsland(page);
  await expect(needYou(page)).toHaveText('1');
  await page.keyboard.press('Alt+Shift+Space');
  await page.keyboard.press('Meta+3');
  const ask = island(page).getByRole('textbox', { name: 'Ask Spark' });
  await expect(ask).toBeFocused();
  const chips = island(page).getByRole('group', { name: 'Suggested questions' });
  await expect(chips.getByRole('button')).toHaveText(['Who needs me?', 'What’s running?']);
  await ask.fill('Does anyone need anything?');
  await page.keyboard.press('Enter');
  const answers = island(page).locator('.isl-ask-a');
  await expect(answers).toHaveCount(1, { timeout: 20_000 });
  await expect(answers.first()).toContainText('You wrote: "Does anyone need anything?"', {
    timeout: 20_000,
  });
  await expect(island(page).getByRole('button', { name: 'Review “Deploy the site”' })).toHaveCount(
    0,
  );
  await shot(page, 'ask');
  await expect
    .poll(
      async () =>
        (
          await sql(
            `SELECT c.title, r.provider FROM runs r JOIN conversations c ON c.id = r.conversation_id
             JOIN profiles p ON p.assistant_conversation_id = c.id`,
          )
        ).rows,
      { timeout: 20_000 },
    )
    .toEqual([{ title: 'Ask Spark', provider: 'claude' }]);
});

test('the island has no serious accessibility problems in its main views', async ({ page }) => {
  test.setTimeout(90_000);
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(needYou(page)).toHaveText('1');
  const views: string[] = [];
  const check = async (name: string) => {
    await page.waitForTimeout(700);
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (animation) => !(animation instanceof CSSTransition) || animation.playState !== 'running',
        ),
    );
    const results = await new AxeBuilder({ page }).include('.isl-root').analyze();
    for (const violation of results.violations) {
      if (violation.impact === 'serious' || violation.impact === 'critical') {
        views.push(
          `${name}: ${violation.id} ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.any.map((check) => check.message).join(';')}`).join(' | ')}`,
        );
      }
    }
  };
  await check('resting Scout');
  await pointAtScout(page);
  await expect(island(page).locator('.isl-hover')).toContainText('Deploy the site');
  await check('hover line');
  await page.mouse.move(5, 600);
  await page.keyboard.press('Alt+Space');
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await check('card');
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await island(page).locator('.isl-scout-btn').click();
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await check('home opened from Scout');
  await island(page).getByRole('button', { name: 'New chat' }).click();
  await check('quick chat');
  await page.keyboard.press('Meta+3');
  await check('ask');
  await page.keyboard.press('Meta+1');
  await check('home again');
  expect(views).toEqual([]);
});

test('without a notch Scout peeks on its own, hover opens the full panel and a click focuses it', async ({
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
  await expect.poll(async () => (await scout.boundingBox())!.y).toBe(-31);
  expect((await scout.boundingBox())!.height).toBe(58);
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
  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  const box = (await island(page).boundingBox())!;
  await expect(island(page)).not.toHaveClass(/\bbare\b/);
  await expect.poll(lastRest).toBeNull();
  expect((await island(page).boundingBox())!.y).toBe(0);
  const lastFocus = () =>
    page.evaluate(() => (window as unknown as { islandFocus: boolean[] }).islandFocus.at(-1));
  expect(await lastFocus()).not.toBe(true);
  await expect(inbox(page, 'Nothing needs you')).toBeVisible();
  const newChat = island(page).getByRole('button', { name: 'New chat' });
  await expect(newChat).toHaveCSS('cursor', 'pointer');
  await newChat.click();

  const message = island(page).getByRole('textbox', { name: 'Message' });
  await expect(message).toBeFocused();
  await expect.poll(lastFocus).toBe(true);
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
  await page.mouse.move(box.x + box.width / 2, 600);
  await page.waitForTimeout(700);
  await expect(message).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(message).toHaveCount(0);
  await expect.poll(lastFocus).toBe(false);

  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await island(page).getByRole('button', { name: 'New chat' }).click();
  await expect(message).toBeFocused();
  await message.fill('Keep this draft');
  await message.blur();
  await page.evaluate(() => (window as unknown as { islandEscape: () => void }).islandEscape());
  await expect(message).toHaveCount(0);
  await expect.poll(lastFocus).toBe(false);
});
