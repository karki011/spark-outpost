import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { pointAtScout } from './island-pointer.ts';
import {
  focusCalls,
  island,
  openNotchIsland,
  settled,
  underNotch,
  VIEWPORT,
  type NotchSetup,
} from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
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

const strip = (page: Page) => island(page).locator('.isl-strip');
const count = (page: Page) => island(page).getByLabel('1 need you', { exact: true });
const hoverLine = (page: Page) => island(page).locator('.isl-hover');
const focusCard = (page: Page) =>
  island(page).getByRole('article', { name: 'Add the image library needs you' });

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-strip-${name}.png`),
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

const pending = async () =>
  (await sql(`SELECT count(*)::int AS n FROM approvals WHERE status = 'pending'`)).rows[0]!.n;

const statuses = async () =>
  (await sql(`SELECT status FROM approvals ORDER BY created_at`)).rows.map((row) => row.status);

async function setAsideKeys(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/attention');
  const body = (await response.json()) as { items: { key: string; setAsideAt: string | null }[] };
  return body.items.filter((item) => item.setAsideAt !== null).map((item) => item.key);
}

async function openHomeFromStrip(page: Page) {
  await page.mouse.move(5, 600);
  await strip(page).click();
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(island(page).locator('[data-panel="home"]')).toBeVisible();
}

for (const [place, setup] of Object.entries(PLACES)) {
  test(`${place}: a waiting request rests as a count in the strip and a click opens Home`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await openNotchIsland(page, { size: 'large', autoExpand: false, ...setup });
    await seedChats([install]);
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await expect(count(page)).toHaveText('1');
    await expect(island(page).locator('.isl-restline')).toHaveCount(0);
    await settled(page);
    const box = (await strip(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    if (setup.notch !== false) {
      expect((await underNotch(page)).filter((hit) => !hit.includes('isl-strip"'))).toEqual([]);
    }
    await shot(page, `count-${place}`);
    await strip(page).click();
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    await expect(focusCard(page)).toBeVisible();
    await expect(focusCard(page).getByRole('button', { name: /^Allow/ })).toBeVisible();
  });
}

for (const answer of ['Allow', 'Deny'] as const) {
  test(`hovering Scout turns the strip into the request's line and ${answer} answers it in place without taking focus`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
    await seedChats([install]);
    await expect(count(page)).toHaveText('1');
    await pointAtScout(page);
    await expect(hoverLine(page)).toBeVisible();
    await expect(hoverLine(page)).toContainText('Add the image library');
    await expect(hoverLine(page)).toContainText('npm install sharp');
    await expect(island(page)).toHaveAttribute('data-view', 'now');
    await expect(island(page).locator('[data-panel="home"]')).toHaveCount(0);
    await shot(page, `hover-${answer.toLowerCase()}`);
    await hoverLine(page).getByRole('button', { name: answer, exact: true }).click();
    await expect.poll(statuses).toEqual([answer === 'Allow' ? 'allowed' : 'denied']);
    expect(await focusCalls(page)).not.toContain(true);
    await page.mouse.move(5, 600);
    await expect(island(page)).not.toHaveAttribute('data-view', 'card');
    await expect(island(page).locator('[data-panel="home"]')).toHaveCount(0);
    await expect(count(page)).toHaveCount(0);
  });
}

test('the strip rests without motion under Reduce Motion, takes keyboard focus with a visible ring, and Enter opens Home', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await seedChats([install]);
  await expect(strip(page)).toBeVisible();
  expect(await strip(page).evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'none',
  );
  for (let presses = 0; presses < 6; presses += 1) {
    await page.keyboard.press('Tab');
    if (await strip(page).evaluate((element) => element === document.activeElement)) break;
  }
  await expect(strip(page)).toBeFocused();
  expect(await strip(page).evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
    'solid',
  );
  await page.keyboard.press('Enter');
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(focusCard(page)).toBeVisible();
});

test('Later sets the request aside on the server, leaves a set-aside mark that survives a reload, and a new request counts again', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  const [chatId] = await seedChats([install]);
  await openHomeFromStrip(page);
  await focusCard(page).getByRole('button', { name: 'Later' }).click();
  await expect.poll(() => setAsideKeys(page)).toHaveLength(1);
  await expect(island(page).getByRole('region', { name: /^Set aside/ })).toContainText(
    'Add the image library',
  );

  await page.reload();
  const mark = island(page).locator('.isl-aside');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(mark).toHaveText('1');
  await expect(island(page).locator('.isl-pbadge')).toHaveCount(0);
  await expect(strip(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Spark: 1 set aside. Open Spark Island' }),
  ).toBeVisible();
  await shot(page, 'set-aside');

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
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await expect(count(page)).toHaveText('1');
  await expect(mark).toHaveCount(0);
  await pointAtScout(page);
  await expect(hoverLine(page)).toContainText('npm test');
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
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await expect(island(page).getByLabel('1 working', { exact: true })).toBeVisible();
});

async function seedTwoRequests() {
  await seedChats([
    {
      title: 'Add the image library',
      run: { status: 'awaiting_approval' },
      approvals: [install.approval, { kind: 'execute', title: 'npm test', command: 'npm test' }],
    },
  ]);
}

test('after one answer on Home the next request of that chat cannot be answered at once', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await seedTwoRequests();
  await openHomeFromStrip(page);
  const allow = focusCard(page).getByRole('button', { name: /^Allow/ });
  await expect(allow).toBeEnabled();
  await allow.click();
  await expect.poll(pending).toBe(1);
  await expect(focusCard(page)).toContainText('npm test');
  await expect(allow).toBeDisabled();
  await page.waitForTimeout(300);
  expect(await pending()).toBe(1);
  await expect(allow).toBeEnabled();
  await allow.click();
  await expect.poll(pending).toBe(0);
});

test('after one answer on the hover line the next request of that chat cannot be answered at once', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await seedTwoRequests();
  await pointAtScout(page);
  const allow = hoverLine(page).getByRole('button', { name: 'Allow', exact: true });
  await expect(allow).toBeEnabled();
  await allow.click();
  await expect.poll(pending).toBe(1);
  await expect(hoverLine(page)).toContainText('npm test');
  await expect(allow).toBeDisabled();
  await page.waitForTimeout(300);
  expect(await pending()).toBe(1);
  await expect(allow).toBeEnabled();
  await allow.click();
  await expect.poll(pending).toBe(0);
});
