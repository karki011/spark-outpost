import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import {
  command,
  focusCalls,
  island,
  notchBox,
  openNotchIsland,
  settled,
  sparkFocus,
  underNotch,
} from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const SIZES = ['full', 'small', 'medium', 'large'] as const;
const LONG = 'Rework the checkout flow so that abandoned carts are recovered by email reminders';

const LONG_COMMAND = 'pnpm deploy --prod --region eu-west-1 --tag release-candidate --confirm';

const deploy = {
  title: 'Deploy the site',
  run: { status: 'awaiting_approval' },
  approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
};

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-notch-${name}.png`),
    clip: { x: 320, y: 0, width: 640, height: 300 },
  });
}

async function sql(text: string, chatId: string) {
  const db = openTestDb();
  try {
    await db.query(text, [chatId]);
  } finally {
    await db.end();
  }
}

const touch = (chatId: string) =>
  sql(`UPDATE conversations SET updated_at = now() + interval '1 minute' WHERE id = $1`, chatId);

const finish = (chatId: string) =>
  sql(
    `UPDATE runs SET status = 'succeeded', finished_at = now() WHERE conversation_id = $1`,
    chatId,
  );

async function staysOn(page: Page, view: string) {
  await page.waitForTimeout(1500);
  await expect(island(page)).toHaveAttribute('data-view', view);
}

for (const size of SIZES) {
  test(`at ${size} size nothing readable or clickable sits under the notch`, async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    await seedChats([
      { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 },
      { title: 'Tidy the README', run: { status: 'succeeded' }, minutesAgo: 3 },
    ]);
    await openNotchIsland(page, { size, autoExpand: false });
    const resting = size === 'full' ? 'now' : 'peek';
    await expect(island(page)).toHaveAttribute('data-view', resting);
    await expect(page.getByRole('button', { name: /^Chat: /, disabled: false })).toHaveCount(
      size === 'full' ? 0 : 2,
    );
    expect(await underNotch(page)).toEqual([]);
    await shot(page, `${size}-rest`);

    await seedChats([
      {
        title: LONG,
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'Deploy', command: LONG_COMMAND },
      },
    ]);
    const collapsed = size === 'full' ? 'now' : 'nudge';
    await expect(island(page)).toHaveAttribute('data-view', collapsed);
    await expect(island(page).getByRole('button', { name: /Review/ })).toBeVisible();
    expect(await underNotch(page)).toEqual([]);
    const title = island(page).locator(size === 'full' ? '.isl-nowbar-title' : '.isl-nudge-title');
    await expect(title).toContainText(size === 'full' ? LONG : LONG_COMMAND);
    const clipped = await title.evaluate((element) => ({
      truncated: element.scrollWidth > element.clientWidth,
      rect: element.getBoundingClientRect().toJSON() as DOMRect,
      frame: element.closest('.isl')!.getBoundingClientRect().toJSON() as DOMRect,
    }));
    expect(clipped.truncated).toBe(true);
    expect(clipped.rect.left).toBeGreaterThanOrEqual(clipped.frame.left);
    expect(clipped.rect.right).toBeLessThanOrEqual(clipped.frame.right);
    expect(clipped.rect.top).toBeGreaterThanOrEqual(notchBox().bottom);
    await shot(page, `${size}-needs-you`);

    await page.mouse.move(640, 300);
    const review = (await island(page)
      .getByRole('button', { name: /Review/ })
      .boundingBox())!;
    await page.mouse.move(review.x + review.width / 2, review.y + review.height / 2, { steps: 4 });
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    expect(await underNotch(page)).toEqual([]);
    await page.mouse.move(5, 600);
    await expect(island(page)).toHaveAttribute('data-view', collapsed);
  });
}

for (const size of ['full', 'large'] as const) {
  test(`at ${size} size a request opens once, clear of the notch, without taking the keyboard`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await openNotchIsland(page, { size, autoExpand: true });
    const resting = size === 'full' ? 'now' : 'peek';
    await expect(island(page)).toHaveAttribute('data-view', resting);

    const [first] = await seedChats([deploy]);
    await expect(island(page)).toHaveAttribute('data-view', 'card');
    await expect(island(page).getByRole('button', { name: /Allow once/ })).toBeVisible();
    await expect(island(page)).toContainText('pnpm deploy');
    expect(await underNotch(page)).toEqual([]);
    const card = (await island(page).locator('.isl-card').boundingBox())!;
    expect(card.y).toBeGreaterThanOrEqual(notchBox().bottom);
    expect(await focusCalls(page)).not.toContain(true);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await shot(page, `${size}-request`);

    await island(page).getByRole('button', { name: 'Later' }).click();
    await page.mouse.move(5, 600);
    await expect(island(page)).toHaveAttribute('data-view', resting);
    await touch(first!);
    await staysOn(page, resting);
    await sparkFocus(page, true);
    await sparkFocus(page, false);
    await staysOn(page, resting);

    const [second] = await seedChats([
      {
        title: 'Speed up the test suite',
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'npm test', command: 'npm test' },
      },
    ]);
    await expect(island(page)).toHaveAttribute('data-view', 'card');
    await expect(island(page)).toContainText('npm test');
    const allow = island(page).getByRole('button', { name: /Allow once/ });
    await expect(allow).toBeEnabled();
    await allow.click();
    await expect(island(page)).toContainText('Allowed once');
    await finish(second!);
    await page.mouse.move(5, 600);
    await expect(island(page)).toHaveAttribute('data-view', resting);
    await staysOn(page, resting);
    expect(await focusCalls(page)).not.toContain(true);
  });
}

test('a request waits while Spark is focused or a panel is open, and Escape puts it away for good', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'medium', autoExpand: true, sparkFocused: true });
  await seedChats([deploy]);
  await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
  await staysOn(page, 'peek');
  await command(page, 'sessions');
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await sparkFocus(page, false);
  await staysOn(page, 'panel');
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'card');

  await command(page, 'quick');
  await expect.poll(() => focusCalls(page)).toContain(true);
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'nudge');
  expect(await underNotch(page)).toEqual([]);
  await staysOn(page, 'nudge');
});

test('with the switch off a request stays a pill until it is opened', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  await seedChats([deploy]);
  await expect(island(page)).toHaveAttribute('data-view', 'nudge');
  await staysOn(page, 'nudge');
});

test('the full island shows the current chat on a display without a notch', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
  await openNotchIsland(page, { size: 'full', autoExpand: true, notch: false });
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  const bar = island(page).getByRole('status').filter({ hasText: 'Fix billing totals' });
  await expect(bar).toBeVisible();
  await settled(page);
  const box = (await island(page).boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.width).toBeLessThanOrEqual(420);
  expect(box.height).toBeLessThanOrEqual(90);
  await shot(page, 'full-flat');
  await page.mouse.move(640, 300);
  await page.mouse.move(640, 40, { steps: 4 });
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).getByRole('tab', { name: 'Home' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'now');
});

test.describe('screenshots', () => {
  test.use({ deviceScaleFactor: 2 });
  for (const theme of ['graphite', 'apricot']) {
    test(`shows the full island and a request in ${theme}`, async ({ page }) => {
      test.skip(!SHOTS, 'screenshots only');
      await resetTestDatabase({ onboarded: true });
      await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
      await openNotchIsland(page, { size: 'full', autoExpand: true, theme });
      await expect(island(page)).toHaveAttribute('data-view', 'now');
      await shot(page, `${theme}-full`);
      await seedChats([deploy]);
      await expect(island(page)).toHaveAttribute('data-view', 'card');
      await shot(page, `${theme}-request`);
    });
  }
});
