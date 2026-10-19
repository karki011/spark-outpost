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
];

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

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
        '.isl-st, .isl-wlabel, .isl-restline-text, .isl-now-title, .isl-needs-text',
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
    await page.keyboard.press('Meta+4');
    await expectClean(page, 'ask');
    await page.keyboard.press('Meta+1');
    await expectClean(page, 'home, quiet');
    await page.keyboard.press('Escape');

    await seedChats([
      { title: LONG, run: { status: 'failed' } },
      { title: 'Fix image uploads', run: { status: 'succeeded' } },
      { title: 'Add dark mode toggle', run: { status: 'succeeded' } },
      { title: 'Speed up cold start', run: { status: 'succeeded' } },
    ]);
    await expect(page.getByRole('button', { name: /^Chat: / })).toHaveCount(4);
    await pointAtScout(page);
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    await expect(island(page).getByRole('region', { name: /^Now/ })).toBeVisible();
    await expectClean(page, 'home on hover');
    await page.mouse.move(width / 2, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');

    await command(page, 'sessions');
    await expectClean(page, 'sessions, many');
    await page.keyboard.press('Meta+1');
    await expectClean(page, 'home, many');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    const [asking] = await seedChats([
      {
        title: LONG,
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy --prod' },
      },
    ]);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
    await expectClean(page, 'collapsed approval');
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
    await page.mouse.move(width / 2, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await pointAtScout(page);
    const now = island(page).getByRole('region', { name: /^Now/ });
    await expect(now).toContainText(LONG);
    await expectClean(page, 'home after a run');
    await now.getByRole('button', { name: /^Open / }).click({ modifiers: ['Meta'] });
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
  const scout = island(page).locator('.isl-scout-wrap svg.scout');
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
  { name: 'stays collapsed in another app', sparkFocused: false, expected: 'peek' },
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
    await pointAtScout(page);
    if (sparkFocused) {
      const now = island(page).getByRole('region', { name: 'Now: Deploy the site' });
      await now.getByRole('button', { name: 'Open Deploy the site' }).click();
    } else {
      await island(page).getByRole('group', { name: 'Waiting for you' }).click();
    }
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    const waiting = island(page).getByRole('group', { name: 'Waiting for you' });
    await expect(waiting).toBeFocused();
    await expect(waiting.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await expectClean(page, 'inline chat with an approval');
  });
}

test('clicking the blob opens Home, quiet or busy, and the shortcuts still open their panels', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeFlatDesktop(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  const scoutButton = island(page).getByRole('button', { name: 'Open Spark Island' });
  await scoutButton.focus();
  await page.keyboard.press('Enter');
  await expect(island(page).getByRole('tab', { name: 'Home' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(island(page).getByRole('region', { name: 'Now' })).toContainText('All quiet');
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
  await expect(island(page).getByRole('region', { name: 'Now: Fix image uploads' })).toBeVisible();
  await page.keyboard.press('Escape');
  await command(page, 'sessions');
  const list = island(page).getByRole('listbox', { name: 'Recent sessions' });
  await expect(list.getByRole('group', { name: 'Running' })).toContainText('Fix image uploads');
  await expect(list.getByRole('group', { name: 'Recent' })).toContainText('Speed up cold start');
  await expect(list.getByRole('group', { name: 'Needs you' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await command(page, 'quick');
  await expect(island(page).getByRole('tab', { name: 'New chat' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('hovering a collapsed Island opens the waiting chat, and leaving closes it', async ({
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
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).getByRole('tab', { name: /^Chats/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const waiting = island(page).getByRole('group', { name: 'Waiting for you' });
  await expect(waiting.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
  await expectClean(page, 'pending chat on hover');
  await page.mouse.move(640, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
});
