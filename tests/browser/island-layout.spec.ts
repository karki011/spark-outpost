import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const PARTS = [
  '.isl-wlabel',
  '.isl-wr',
  '.isl-tabs',
  '.isl-qc',
  '.isl-search',
  '.isl-slist',
  '.isl-sempty',
  '.isl-card',
  '.isl-hlist',
  '.isl-hall',
  '.isl-khint',
];
const TEXT = ['.isl-wlabel', '.isl-tabs', '.isl-ttl', '.isl-hint', '.isl-htitle', '.isl-who'];

const island = (page: Page) => page.getByRole('region', { name: 'Spark companion' });

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function fakeFlatDesktop(page: Page) {
  await page.addInitScript(() => {
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
          onCommand: (callback: (action: string) => void) => {
            Object.assign(window, { islandCommand: callback });
            return () => undefined;
          },
          onEscape: none,
          setInteractive: () => undefined,
          setFocusable: () => undefined,
          drag: () => undefined,
          openChat: () => undefined,
          setRestSize: () => undefined,
        },
        onOpenChat: none,
      },
    });
  });
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
      for (const { selector, element } of visible('.isl-htitle, .isl-st, .isl-wlabel')) {
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
    await expect(island(page).getByRole('list', { name: 'Active chats' })).toBeVisible();
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
    await expect(island(page)).toHaveAttribute('data-view', 'moment');
    await expectClean(page, 'moment');
    await island(page).getByRole('button', { name: 'Open chat' }).click();
    await expect(island(page)).toHaveAttribute('data-view', 'note');
    await expectClean(page, 'opening note');
  });
}

test('a run that finishes while a panel is open waits for the panel to close', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  const [running] = await seedChats([{ title: 'Fix image uploads', run: { status: 'running' } }]);
  await expect(island(page)).toHaveAttribute('data-view', 'live');
  await command(page, 'quick');
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await sql(
    `UPDATE runs SET status = 'succeeded', finished_at = now() WHERE conversation_id = $1`,
    [running],
  );
  await page.waitForTimeout(2500);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).locator('.isl-view')).toHaveCount(1);
  await expect(island(page)).not.toContainText('Fix image uploads is done');
  await expectClean(page, 'panel with a waiting moment');
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'moment');
  await expect(island(page).locator('.isl-view')).toHaveCount(1);
});

test('hovering lists the active chats, attention first, and keeps the plain pill when there are none', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page);
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
  await expect(island(page).getByRole('list', { name: 'Active chats' })).toHaveCount(0);
  await expect(island(page).getByRole('button', { name: 'New chat' })).toBeVisible();
  await page.mouse.move(640, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');

  await seedChats([
    { title: 'Fix image uploads', run: { status: 'succeeded' }, minutesAgo: 3 },
    { title: 'Add dark mode toggle', run: { status: 'failed' }, minutesAgo: 5 },
    { title: 'Speed up cold start', run: { status: 'succeeded' }, minutesAgo: 1 },
  ]);
  await expect(page.getByRole('button', { name: /^Chat: / })).toHaveCount(3);
  await hover();
  const rows = island(page).getByRole('list', { name: 'Active chats' }).getByRole('button');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Add dark mode toggle');
  await expect(rows.nth(0)).toContainText('failed');
  await expect(rows.nth(1)).toContainText('Speed up cold start');
  await expect(rows.nth(1)).toContainText('done');
  await expect(island(page).getByRole('button', { name: 'New chat' })).toBeVisible();
  await island(page).getByRole('button', { name: 'See all' }).click();
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
