import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';
import { pointAtScout } from './island-pointer.ts';

const PARTS = [
  '.isl-wlabel',
  '.isl-wr',
  '.isl-tabs',
  '.isl-qc',
  '.isl-search',
  '.isl-slist',
  '.isl-sempty',
  '.isl-card',
  '.isl-khint',
  '.isl-hcard',
  '.isl-dots',
  '.isl-strip',
  '.isl-hover',
  '.isl-focus',
  '.isl-working',
];
const TEXT = [
  '.isl-wlabel',
  '.isl-tabs',
  '.isl-ttl',
  '.isl-hint',
  '.isl-hhead',
  '.isl-who',
  '.isl-now-title',
  '.isl-needs-text',
  '.isl-meet-row span',
  '.isl-hover-text',
  '.isl-focus-title',
];

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });
const strip = (page: Page) => island(page).locator('button.isl-strip');
const hoverLine = (page: Page) => island(page).locator('.isl-hover');
const needYou = (page: Page) => island(page).getByLabel('1 need you', { exact: true });

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
          setFocusable: (on: boolean) => {
            const record = window as unknown as { islandFocus?: boolean[] };
            (record.islandFocus ??= []).push(on);
          },
          drag: () => undefined,
          openChat: (id: string | null) => {
            const record = window as unknown as { openedChats?: (string | null)[] };
            (record.openedChats ??= []).push(id);
          },
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
        '.isl-st, .isl-wlabel, .isl-now-title, .isl-hover-text b, .isl-hover-text span, .isl-focus-chat, .isl-focus-title, .isl-work-text b',
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
    await page.keyboard.press('Meta+3');
    await expectClean(page, 'ask');
    await page.keyboard.press('Meta+1');
    await expectClean(page, 'home, quiet');
    await page.keyboard.press('Escape');

    await seedChats([
      { title: LONG, run: { status: 'succeeded' }, unread: true },
      { title: 'Fix image uploads', run: { status: 'running' } },
      { title: 'Add dark mode toggle', run: { status: 'succeeded' } },
      { title: 'Speed up cold start', run: { status: 'succeeded' } },
    ]);
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await expect(island(page).getByLabel('1 working', { exact: true })).toBeVisible();
    await expectClean(page, 'resting strip');
    await strip(page).click();
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    await expect(island(page).getByRole('region', { name: /^Working/ })).toContainText(
      'Fix image uploads',
    );
    await expect(island(page)).not.toContainText(LONG);
    await expectClean(page, 'home with work');
    await page.keyboard.press('Escape');
    await page.mouse.move(width / 2, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'now');

    await expect(island(page).locator('.isl-view')).toHaveCount(1);
    await command(page, 'sessions');
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    await expect(island(page).locator('.isl-view')).toHaveCount(1);
    await expectClean(page, 'home from its shortcut');
    await page.keyboard.press('Escape');

    const [asking] = await seedChats([
      {
        title: LONG,
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy --prod' },
      },
    ]);
    await expect(needYou(page)).toBeVisible();
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await expectClean(page, 'strip with a request');
    await strip(page).click();
    await expect(island(page).getByRole('article', { name: `${LONG} needs you` })).toBeVisible();
    await expectClean(page, 'home with a long request');
    await page.keyboard.press('Escape');
    await page.mouse.move(width / 2, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await pointAtScout(page);
    await expect(hoverLine(page)).toContainText(LONG);
    await expectClean(page, 'hover line');
    await page.mouse.move(width / 2, 600);
    await expect(hoverLine(page)).toHaveCount(0);
    await command(page, 'quick');
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
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await strip(page).click();
    await expect(island(page).getByRole('region', { name: /^Working/ })).toContainText(
      'Fix image uploads',
    );
    await expectClean(page, 'home after a run');
  });
}

test('running and finished work never expand the island', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  const [running] = await seedChats([{ title: 'Fix image uploads', run: { status: 'running' } }]);
  const scout = island(page).locator('.isl-scout-wrap svg.scout');
  await expect(scout).toHaveClass(/\bworking\b/);
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await page.waitForTimeout(1200);
  await expect(island(page)).toHaveAttribute('data-view', 'now');
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

for (const { name, sparkFocused } of [
  { name: 'stays at rest in another app', sparkFocused: false },
  { name: 'stays quiet while the Spark window is focused', sparkFocused: true },
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
    await expect(needYou(page)).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await pointAtScout(page);
    await expect(hoverLine(page).getByRole('button', { name: 'Allow' })).toBeVisible();
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await hoverLine(page)
      .getByRole('button', { name: /^Deploy the site/ })
      .click();
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    const card = island(page).getByRole('article', { name: 'Deploy the site needs you' });
    await expect(card.getByRole('button', { name: /^Allow/ })).toBeVisible();
    await expectClean(page, 'home with an approval');
  });
}

test('clicking Scout opens Home, quiet or busy, and the shortcuts still open their panels', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  const scoutButton = island(page).locator('button.isl-scout-btn');
  await scoutButton.focus();
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('region', { name: 'Nothing needs you' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await seedChats([
    { title: 'Fix image uploads', run: { status: 'running' } },
    { title: 'Speed up cold start', run: { status: 'succeeded' } },
  ]);
  await page.mouse.move(640, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await scoutButton.focus();
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('region', { name: /^Working/ })).toContainText(
    'Fix image uploads',
  );
  await page.keyboard.press('Escape');
  await command(page, 'sessions');
  await expect(island(page).getByRole('region', { name: /^Working/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await command(page, 'quick');
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toBeVisible();
  await expect(island(page).getByRole('button', { name: 'New chat' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('hovering Scout shows the top request, Allow answers in place without taking focus, and leaving restores the strip', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await seedChats([
    { title: 'Fix image uploads', run: { status: 'running' }, minutesAgo: 1 },
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
      minutesAgo: 8,
    },
  ]);
  await expect(needYou(page)).toBeVisible();
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await pointAtScout(page);
  const allow = hoverLine(page).getByRole('button', { name: 'Allow' });
  await expect(allow).toBeVisible();
  await expect(hoverLine(page)).toContainText('Deploy the site');
  await expectClean(page, 'pending chat on hover');
  await allow.click();
  await expect
    .poll(async () => (await sql(`SELECT status FROM approvals`)).rows[0]?.status)
    .toBe('allowed');
  await expect(needYou(page)).toHaveCount(0);
  const recorded = await page.evaluate(() => {
    const record = window as unknown as { islandFocus?: boolean[]; openedChats?: unknown[] };
    return { focus: record.islandFocus ?? [], opened: record.openedChats ?? [] };
  });
  expect(recorded.focus).not.toContain(true);
  expect(recorded.opened).toEqual([]);
  await page.mouse.move(640, 600);
  await expect(hoverLine(page)).toHaveCount(0);
  await expect(strip(page)).toBeVisible();
  await expect(island(page)).toHaveAttribute('data-view', 'now');
});
