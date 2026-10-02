import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const PARTS = [
  '.isl-wlabel',
  '.isl-hsec',
  '.isl-wr',
  '.isl-tabs',
  '.isl-qc',
  '.isl-search',
  '.isl-slist',
  '.isl-sempty',
  '.isl-card',
  '.isl-khint',
];
const TEXT = [
  '.isl-wlabel',
  '.isl-tabs',
  '.isl-ttl',
  '.isl-hint',
  '.isl-htitle',
  '.isl-hhead',
  '.isl-who',
];

const island = (page: Page) => page.getByRole('region', { name: 'Spark companion' });

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function fakeFlatDesktop(page: Page, options = { sparkFocused: false }) {
  await page.addInitScript((options) => {
    const now = new Date();
    localStorage.setItem(
      'spark-outpost.island',
      JSON.stringify({
        lastSeen: now.getTime(),
        greetedDay: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`,
      }),
    );
    const none = () => () => undefined;
    Object.assign(window, {
      sparkDesktop: {
        platform: 'darwin',
        companion: {
          get: async () => ({
            supported: true,
            enabled: true,
            shortcuts: { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' },
            failed: [],
          }),
          onChange: none,
        },
        island: {
          geometry: async () => ({
            notch: false,
            top: 24,
            notchWidth: 0,
            docked: true,
            menuBar: 24,
          }),
          onGeometry: none,
          onCommand: (callback: (action: string) => void) => {
            Object.assign(window, { islandCommand: callback });
            return () => undefined;
          },
          onEscape: none,
          sparkFocused: async () => options.sparkFocused,
          onSparkFocus: (callback: (focused: boolean) => void) => {
            Object.assign(window, { sparkFocus: callback });
            return () => undefined;
          },
          setInteractive: () => undefined,
          setFocusable: () => undefined,
          drag: () => undefined,
          openChat: () => undefined,
          setRestSize: () => undefined,
        },
        onOpenChat: none,
      },
    });
  }, options);
}

const command = (page: Page, action: 'quick' | 'sessions') =>
  page.evaluate(
    (action) => (window as unknown as { islandCommand: (a: string) => void }).islandCommand(action),
    action,
  );

async function settled(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const box = JSON.stringify(await island(page).boundingBox());
      const same = box === last;
      last = box;
      return same;
    })
    .toBe(true);
}

async function expectClean(page: Page, label: string) {
  await settled(page);
  const problems = await island(page).evaluate(
    (root, { parts, text }) => {
      const found: string[] = [];
      const frame = root.getBoundingClientRect();
      const visible = (selector: string) =>
        [...root.querySelectorAll<HTMLElement>(selector)]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => ({ selector, element, rect: element.getBoundingClientRect() }));
      const boxes = parts.flatMap(visible).filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 1 &&
        b.left < a.right - 1 &&
        a.top < b.bottom - 1 &&
        b.top < a.bottom - 1;
      for (const { selector, rect } of boxes) {
        if (
          rect.left < frame.left - 1 ||
          rect.right > frame.right + 1 ||
          rect.top < frame.top - 1 ||
          rect.bottom > frame.bottom + 1
        )
          found.push(`${selector} leaves the island`);
      }
      boxes.forEach((a, index) =>
        boxes.slice(index + 1).forEach((b) => {
          if (a.element.contains(b.element) || b.element.contains(a.element)) return;
          if (overlaps(a.rect, b.rect)) found.push(`${a.selector} overlaps ${b.selector}`);
        }),
      );
      const scout = root.querySelector('.isl-scout-wrap')!.getBoundingClientRect();
      for (const { selector, rect } of text.flatMap(visible)) {
        if (rect.width > 0 && overlaps(scout, rect)) found.push(`the blob covers ${selector}`);
      }
      for (const { selector, element } of visible(
        '.isl-htitle, .isl-hsub, .isl-st, .isl-wlabel, .isl-nudge-title',
      )) {
        if (
          getComputedStyle(element).textOverflow !== 'ellipsis' &&
          element.scrollWidth > element.clientWidth + 1
        )
          found.push(`${selector} overflows`);
      }
      return found;
    },
    { parts: PARTS, text: TEXT },
  );
  expect(problems, label).toEqual([]);
}

const LONG = 'A very long session title that keeps going and going so the row has to cut it short';

for (const width of [420, 1280]) {
  test(`every island view lays out cleanly at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await resetTestDatabase({ onboarded: true });
    await fakeFlatDesktop(page);
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/island');
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await page.waitForTimeout(800);

    await command(page, 'quick');
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    await expectClean(page, 'new chat');
    const panelBox = (await island(page).boundingBox())!;
    expect(panelBox.y).toBe(0);
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
    const radii = await island(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopLeftRadius, style.borderTopRightRadius];
    });
    expect(radii).toEqual(['0px', '0px']);
    await page.keyboard.press('Meta+2');
    await expectClean(page, 'sessions, none');
    await page.keyboard.press('Meta+3');
    await expectClean(page, 'ask');
    await page.keyboard.press('Escape');

    await seedChats([
      { title: LONG, run: { status: 'failed' } },
      { title: 'Fix image uploads', run: { status: 'succeeded' } },
      { title: 'Add dark mode toggle', run: { status: 'succeeded' } },
      { title: 'Speed up cold start', run: { status: 'succeeded' } },
    ]);
    await expect(page.getByRole('button', { name: /^Chat: / })).toHaveCount(4);
    await page.mouse.move(width / 2, 300);
    await page.mouse.move(width / 2, 6, { steps: 4 });
    await expect(island(page)).toHaveAttribute('data-view', 'pill');
    await expect(island(page).getByRole('region', { name: 'Recent' })).toBeVisible();
    await expectClean(page, 'hover list');
    await page.mouse.move(width / 2, 600);

    await command(page, 'sessions');
    await expectClean(page, 'sessions, many');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    const [asking] = await seedChats([
      {
        title: LONG,
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy --prod' },
      },
    ]);
    await expect(island(page)).toHaveAttribute('data-view', 'nudge');
    await expectClean(page, 'nudge');
    await island(page)
      .getByRole('button', { name: /needs you · Review/ })
      .click();
    await expect(island(page)).toHaveAttribute('data-view', 'card');
    await expectClean(page, 'approval');
    const allow = island(page).getByRole('button', { name: /Allow once/ });
    await expect(allow).toBeEnabled();
    await allow.click();
    await expect(island(page)).toContainText('Allowed once');
    await expectClean(page, 'decided note');
    await sql(
      `UPDATE runs SET status = 'succeeded', finished_at = now() WHERE conversation_id = $1`,
      [asking],
    );
    await page.mouse.move(width / 2, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await page.mouse.move(width / 2, 300);
    await page.mouse.move(width / 2, 6, { steps: 4 });
    await expect(island(page).getByRole('region', { name: 'Recent' })).toContainText(LONG);
    await expectClean(page, 'hover list after a run');
    await island(page)
      .getByRole('region', { name: 'Recent' })
      .getByRole('button', { name: /Fix image uploads/ })
      .click();
    await expect(island(page)).toHaveAttribute('data-view', 'note');
    await expectClean(page, 'opening note');
  });
}

test('running and finished work never expand the island', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  const [running] = await seedChats([{ title: 'Fix image uploads', run: { status: 'running' } }]);
  const scout = island(page).locator('svg.scout');
  await expect(scout).toHaveClass(/\bworking\b/);
  await page.waitForTimeout(1200);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await command(page, 'quick');
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await sql(
    `UPDATE runs SET status = 'succeeded', finished_at = now() WHERE conversation_id = $1`,
    [running],
  );
  await page.waitForTimeout(2500);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).locator('.isl-view')).toHaveCount(1);
  await expectClean(page, 'panel while a run finishes');
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.waitForTimeout(1200);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
});

for (const { name, sparkFocused, expected } of [
  { name: 'nudges when you are in another app', sparkFocused: false, expected: 'nudge' },
  { name: 'stays quiet while the Spark window is focused', sparkFocused: true, expected: 'peek' },
]) {
  test(`a chat that needs you ${name}`, async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    await fakeFlatDesktop(page, { sparkFocused });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/island');
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await seedChats([
      {
        title: 'Deploy the site',
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
      },
    ]);
    await page.waitForTimeout(1200);
    await expect(island(page)).toHaveAttribute('data-view', expected);
    if (expected === 'peek') await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
    if (expected === 'nudge') {
      await expectClean(page, 'nudge');
      await page.evaluate(() =>
        (window as unknown as { sparkFocus: (focused: boolean) => void }).sparkFocus(true),
      );
      await expect(island(page)).toHaveAttribute('data-view', 'peek');
      return;
    }
    await page.mouse.move(640, 300);
    await page.mouse.move(640, 6, { steps: 4 });
    const needs = island(page).getByRole('region', { name: 'Needs you' });
    await expect(needs).toContainText('Deploy the site');
    await needs.getByRole('button', { name: 'Review' }).click();
    await expect(island(page)).toHaveAttribute('data-view', 'card');
    await expect(island(page).getByRole('button', { name: /Allow once/ })).toBeVisible();
  });
}

test('clicking the blob opens Sessions, or Ask when there is nothing recent', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  const scoutButton = island(page).getByRole('button', { name: 'Open Spark companion' });
  await scoutButton.focus();
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('tab', { name: 'Ask' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await seedChats([
    { title: 'Fix image uploads', run: { status: 'running' } },
    { title: 'Speed up cold start', run: { status: 'succeeded' } },
  ]);
  await expect(page.getByRole('button', { name: /^Chat: / })).toHaveCount(2);
  await page.mouse.move(640, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await scoutButton.focus();
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const list = island(page).getByRole('listbox', { name: 'Recent sessions' });
  await expect(list.getByRole('group', { name: 'Running' })).toContainText('Fix image uploads');
  await expect(list.getByRole('group', { name: 'Recent' })).toContainText('Speed up cold start');
  await expect(list.getByRole('group', { name: 'Needs you' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await command(page, 'quick');
  await expect(island(page).getByRole('tab', { name: 'New chat' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('hovering groups what needs you, what runs and what finished, and keeps the plain pill when there is nothing', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page, { sparkFocused: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.waitForTimeout(800);
  const hover = async () => {
    await page.mouse.move(640, 300);
    await page.mouse.move(640, 6, { steps: 4 });
    await expect(island(page)).toHaveAttribute('data-view', 'pill');
  };
  await hover();
  await expect(island(page).locator('.isl-hsec')).toHaveCount(0);
  await expect(island(page).getByRole('button', { name: 'New chat' })).toBeVisible();
  await page.mouse.move(640, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');

  await seedChats([
    { title: 'Fix image uploads', run: { status: 'succeeded' }, minutesAgo: 3 },
    { title: 'Add dark mode toggle', run: { status: 'failed' }, minutesAgo: 5 },
    { title: 'Speed up cold start', run: { status: 'running' }, minutesAgo: 1 },
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
      minutesAgo: 8,
    },
  ]);
  await expect(page.getByRole('button', { name: /^Chat: / })).toHaveCount(4);
  await hover();
  const sections = island(page).locator('.isl-hsec');
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0)).toHaveAccessibleName('Needs you');
  await expect(sections.nth(1)).toHaveAccessibleName('Running');
  await expect(sections.nth(2)).toHaveAccessibleName('Recent');
  await expect(sections.nth(0)).toContainText('Deploy the site');
  await expect(sections.nth(1)).toContainText('Speed up cold start');
  const recent = sections.nth(2).getByRole('button');
  await expect(recent).toHaveCount(2);
  await expect(recent.nth(0)).toContainText('Fix image uploads');
  await expect(recent.nth(1)).toContainText('Add dark mode toggle');
  await expect(recent.nth(1)).toContainText('failed');
  await expectClean(page, 'grouped hover list');
  await expect(island(page).getByRole('button', { name: 'New chat' })).toBeVisible();
  await island(page).getByRole('button', { name: 'See all' }).click();
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
