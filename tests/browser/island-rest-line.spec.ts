import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import {
  focusCalls,
  island,
  openNotchIsland,
  restSize,
  settled,
  underNotch,
  VIEWPORT,
  type NotchSetup,
} from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const LONG_COMMAND = 'pnpm deploy --prod --region eu-west-1 --tag release-candidate --confirm';
const install = {
  title: 'Add the image library',
  run: { status: 'awaiting_approval' },
  approval: { kind: 'execute', title: 'npm install sharp', command: 'npm install sharp' },
};
const PLACES: Record<string, Partial<NotchSetup>> = {
  notch: {},
  flat: { notch: false },
  floating: { notch: false, docked: false },
};

const line = (page: Page) => island(page).locator('.isl-restline');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-nudge-${name}.png`),
    clip: { x: 240, y: 0, width: 800, height: 240 },
  });
}

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

const answerAll = () =>
  sql(
    `UPDATE approvals SET status = 'allowed', decided_at = now(), decided_by = 'user',
       decision_option_id = 'allow', scope = 'once' WHERE status = 'pending'`,
  );

const endRun = (chatId: string, status: string) =>
  sql(`UPDATE runs SET status = $2, finished_at = now() WHERE conversation_id = $1`, [
    chatId,
    status,
  ]);

async function overlaps(first: Locator, second: Locator): Promise<boolean> {
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

for (const [place, setup] of Object.entries(PLACES)) {
  for (const size of ['small', 'large', 'xlarge'] as const) {
    test(`${place}, ${size}: the resting island names the request beside Scout and a click opens it`, async ({
      page,
    }) => {
      await resetTestDatabase({ onboarded: true });
      const theme = size === 'large' ? 'apricot' : 'graphite';
      await openNotchIsland(page, { size, autoExpand: false, theme, ...setup });
      await seedChats([install]);
      await expect(line(page)).toHaveText('Approve: run npm install sharp·Review');
      await expect(line(page)).toHaveAttribute('title', 'Approve: run npm install sharp · Review');
      await expect(island(page)).toHaveAttribute('data-view', 'peek');
      await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
      await settled(page);
      const box = (await line(page).boundingBox())!;
      const scout = (await island(page).locator('.isl-scout-wrap').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(scout.x + scout.width);
      expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      for (const blob of await page.locator('.isl-peekblob, .isl-pb').all()) {
        expect(await overlaps(line(page), blob)).toBe(false);
      }
      if (setup.notch !== false) expect(await underNotch(page)).toEqual([]);
      if (place === 'flat') {
        await expect
          .poll(async () => ((await restSize(page))?.width ?? 0) / 2)
          .toBeGreaterThanOrEqual(box.x + box.width - VIEWPORT.width / 2);
        expect((await restSize(page))!.height).toBeGreaterThanOrEqual(box.y + box.height);
      }
      await shot(page, `waiting-${place}-${size}-${theme === 'apricot' ? 'light' : 'dark'}`);

      await line(page).click();
      await expect(island(page)).toHaveAttribute('data-view', 'card');
      await expect(island(page).getByRole('button', { name: /Allow once/ })).toBeVisible();
      await expect.poll(() => focusCalls(page)).toContain(true);
    });
  }
}

test('several waiting requests show the oldest, cut short with its full text in the title, and count the rest', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'medium', autoExpand: false });
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: LONG_COMMAND },
    },
    install,
    {
      title: 'Rename the helper',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'edit', title: 'Edit', paths: ['src/util/format-date.ts'] },
    },
  ]);
  await expect(line(page)).toContainText('+2 more');
  await expect(island(page).locator('.isl-pbadge')).toHaveText('3');
  await expect(line(page)).toHaveAttribute(
    'title',
    `Approve: run ${LONG_COMMAND} · Review · +2 more`,
  );
  const text = line(page).locator('.isl-restline-text');
  const cut = await text.evaluate((element) => ({
    shown: element.clientWidth,
    full: element.scrollWidth,
    overflow: getComputedStyle(element).textOverflow,
  }));
  expect(cut.full).toBeGreaterThan(cut.shown);
  expect(cut.shown).toBeGreaterThan(30);
  expect(cut.overflow).toBe('ellipsis');
  const box = (await line(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width / 2 + 360);
  await expect(line(page).getByText('Review')).toBeVisible();
  expect(await underNotch(page)).toEqual([]);
  await shot(page, 'several-waiting');
});

test('the line takes keyboard focus with a visible ring and Enter opens the request', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await seedChats([install]);
  await expect(line(page)).toBeVisible();
  for (let presses = 0; presses < 6; presses += 1) {
    await page.keyboard.press('Tab');
    if (await line(page).evaluate((element) => element === document.activeElement)) break;
  }
  await expect(line(page)).toBeFocused();
  expect(await line(page).evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
    'solid',
  );
  await page.keyboard.press('Enter');
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await expect(island(page).locator('.isl-card')).toBeFocused();
});

for (const [status, kind, said] of [
  ['succeeded', 'done', 'Fix billing totals is done.'],
  ['failed', 'failed', 'Fix billing totals couldn’t finish.'],
] as const) {
  test(`a chat that ${kind === 'done' ? 'finishes' : 'fails'} says so beside Scout once, then the line leaves`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    const [chatId] = await seedChats([{ title: 'Fix billing totals', run: { status: 'running' } }]);
    await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
    await expect(page.getByRole('button', { name: /^Chat: Fix billing totals/ })).toBeVisible();
    await expect(line(page)).toHaveCount(0);
    await endRun(chatId!, status);
    await expect(line(page)).toHaveText(said);
    await expect(line(page)).toHaveAttribute('data-kind', kind);
    await expect(line(page)).toHaveAttribute('title', said);
    await expect(page.locator('.isl-root [aria-live]')).toHaveCount(1);
    await expect(page.locator('.isl-root [aria-live]')).toHaveText(said);
    await expect(line(page)).not.toHaveAttribute('role');
    await shot(page, `${kind}-line`);
    await expect(line(page)).toHaveCount(0, { timeout: 8_000 });
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
  });
}

test('Later leaves a set-aside mark instead of the alert badge, survives a reload and ends with a new request', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  const [chatId] = await seedChats([install]);
  await line(page).click();
  await island(page).getByRole('button', { name: 'Later' }).click();
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  const mark = island(page).locator('.isl-aside');
  await expect(mark).toHaveText('1');
  await expect(island(page).locator('.isl-pbadge')).toHaveCount(0);
  await expect(line(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Spark: 1 set aside. Open Spark Island' }),
  ).toBeVisible();
  await expect(island(page)).toHaveClass(/\btucked\b/);
  const shown = (await mark.boundingBox())!;
  expect(shown.y).toBeGreaterThanOrEqual(0);
  await shot(page, 'set-aside');

  await page.reload();
  await expect(mark).toHaveText('1');
  await expect(island(page).locator('.isl-pbadge')).toHaveCount(0);
  await expect(line(page)).toHaveCount(0);

  await answerAll();
  const run = await sql(`SELECT id FROM runs WHERE conversation_id = $1`, [chatId]);
  await sql(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status, created_at)
     SELECT gen_random_uuid(), run_id, 'tool-next', kind, 'npm test',
       jsonb_set(payload, '{command}', '"npm test"'), 'hash-next', options, 'pending', now()
     FROM approvals WHERE run_id = $1 LIMIT 1`,
    [run.rows[0]!.id],
  );
  await expect(line(page)).toContainText('Approve: run npm test');
  await expect(mark).toHaveCount(0);
  await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
});

test('a request that opened by itself stays open under the pointer and away from it until it is answered', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: true, notch: false });
  await seedChats([install]);
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  const card = (await island(page).locator('.isl-card').boundingBox())!;
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 4 });
  await page.waitForTimeout(2_500);
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await page.mouse.move(5, 600, { steps: 4 });
  await page.waitForTimeout(8_000);
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await expect(island(page).getByRole('button', { name: /Allow once/ })).toBeVisible();
  await answerAll();
  await sql(`UPDATE runs SET status = 'running' WHERE status = 'awaiting_approval'`);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
});

test('after one answer in the chat panel the card that slides up cannot be answered at once', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await seedChats([
    {
      title: 'Add the image library',
      run: { status: 'awaiting_approval' },
      approvals: [install.approval, { kind: 'execute', title: 'npm test', command: 'npm test' }],
    },
  ]);
  await page.getByRole('button', { name: /^Chat: Add the image library/ }).click();
  const waiting = island(page).getByRole('group', { name: 'Waiting for you' });
  const allow = waiting.getByRole('button', { name: 'Allow', exact: true });
  await expect(allow).toHaveCount(2);
  const pending = async () =>
    (await sql(`SELECT count(*)::int AS n FROM approvals WHERE status = 'pending'`)).rows[0]!.n;
  await allow.first().click();
  await expect(waiting.locator('.appr')).toHaveCount(1);
  await allow.click({ force: true });
  await expect(waiting).toHaveAttribute('data-arming', 'true');
  await page.waitForTimeout(300);
  expect(await pending()).toBe(1);
  await expect(waiting).not.toHaveAttribute('data-arming');
  await allow.click();
  await expect.poll(pending).toBe(0);
});
