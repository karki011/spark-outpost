import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedFlowChats } from './ticket-flow-seed.ts';
import { animationsSettled } from './settle.ts';
import {
  connectTickets,
  openTickets,
  resetTicketFakes,
  seedTicketVolume,
  STUB_URL,
} from './ticket-seed.ts';

const SHOTS = process.env.SPARK_TICKET_SHOTS;
const INFO_CELLS = ['.tk-key', '.fchip', '.tk-title', '.why-r', '.age', '.ir-who'];
const FIXED_CELLS = ['.pri', '.tk-key', '.fchip', '.tk-title', '.age', '.ir-who'];
const STARTED = 'CP-48001';
const UP_NEXT = 'CP-48005';
const LONG_STATUS = 'CP-48024';
const DONE = 'CP-48026';

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const views = (page: Page) => main(page).getByRole('navigation', { name: 'Ticket views' });

async function box(target: Locator) {
  const found = await target.boundingBox();
  if (!found) throw new Error('Expected a rendered element');
  return found;
}

const boxes = (target: Locator, cells: readonly string[]) =>
  Promise.all(cells.map((cell) => box(target.locator(cell).first())));

async function placed(target: Locator, cells: readonly string[]) {
  const [frame, ...found] = await Promise.all([
    box(target),
    ...cells.map((cell) => box(target.locator(cell).first())),
  ]);
  return found.map((cell) => ({
    x: Math.round(cell.x - frame!.x),
    y: Math.round(cell.y - frame!.y),
    width: Math.round(cell.width),
    height: Math.round(cell.height),
  }));
}

async function openVolume(page: Page) {
  await seedTicketVolume();
  await connectTickets(page, ['jira']);
  await openTickets(page);
  await expect(row(page, UP_NEXT)).toBeVisible({ timeout: 15_000 });
}

async function showDone(page: Page) {
  await main(page)
    .getByRole('region', { name: 'Done recently', exact: true })
    .getByRole('button', { name: /^Done recently/ })
    .click();
  await expect(row(page, DONE)).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
  await request.post(`${STUB_URL}/github-test/reset`);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('every view in the side column is one line: icon, label, count', async ({ page }) => {
  await openVolume(page);
  const rail = page.getByRole('navigation', { name: 'Main' });
  await rail.getByRole('button', { name: /^Chats/ }).click();
  await rail.getByRole('button', { name: /^Tickets/ }).click();
  const items = views(page).locator('.ib-item');
  await expect(items).toHaveCount(7);
  await expect(views(page).getByRole('button', { name: 'Needs you 0' })).toBeVisible();
  const rights: number[] = [];
  for (const item of await items.all()) {
    const [icon, label, count] = await boxes(item, ['svg', '.l', '.n']);
    const middle = (part: { y: number; height: number }) => part.y + part.height / 2;
    expect((await box(item)).height).toBeLessThan(36);
    expect(Math.abs(middle(icon!) - middle(label!))).toBeLessThan(3);
    expect(Math.abs(middle(count!) - middle(label!))).toBeLessThan(3);
    expect(icon!.x + icon!.width).toBeLessThanOrEqual(label!.x);
    expect(label!.x + label!.width).toBeLessThanOrEqual(count!.x);
    rights.push(Math.round(count!.x + count!.width));
    const name = await item.locator('.l').textContent();
    await expect(item.locator('.l')).toHaveAttribute('title', name!);
  }
  expect(new Set(rights).size).toBe(1);
});

test('hovering a row keeps every detail in place and reveals Start at the end', async ({
  page,
}) => {
  await openVolume(page);
  const target = row(page, UP_NEXT);
  const start = target.getByRole('button', { name: `Start ${UP_NEXT}` });
  const slot = target.locator('.ir-acts');
  await animationsSettled(page);
  const before = await placed(target, INFO_CELLS);
  const height = (await box(target)).height;
  await expect(slot).toHaveCSS('opacity', '0');

  await target.hover();
  await expect(slot).toHaveCSS('opacity', '1');
  expect(await placed(target, INFO_CELLS)).toEqual(before);
  expect((await box(target)).height).toBe(height);
  for (const cell of ['.tk-key', '.fchip', '.tk-title', '.age', '.ir-who']) {
    await expect(target.locator(cell)).toBeVisible();
  }
  const title = await box(target.locator('.tk-title'));
  const who = await box(target.locator('.ir-who'));
  const action = await box(start);
  expect(action.x).toBeGreaterThanOrEqual(who.x + who.width);
  expect(title.x + title.width).toBeLessThanOrEqual(action.x);

  await page.mouse.move(0, 0);
  await expect(slot).toHaveCSS('opacity', '0');
  await target.locator('.ir-main').focus();
  await page.keyboard.press('Tab');
  await expect(start).toBeFocused();
  await expect(slot).toHaveCSS('opacity', '1');
  expect(await placed(target, INFO_CELLS)).toEqual(before);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: `Start work on ${UP_NEXT}` })).toBeVisible();
});

test('the status badge is as wide as its label and long names truncate', async ({ page }) => {
  await openVolume(page);
  await showDone(page);
  const badge = (key: string) => row(page, key).locator('.fchip');
  const started = await box(badge(STARTED));
  const backlog = await box(badge(UP_NEXT));
  const done = await box(badge(DONE));
  const long = await box(badge(LONG_STATUS));
  expect(done.width).toBeLessThan(backlog.width);
  expect(backlog.width).toBeLessThan(started.width);
  expect(started.width).toBeLessThan(long.width);
  expect(new Set([started, backlog, done, long].map((found) => Math.round(found.x))).size).toBe(1);

  const label = badge(DONE).locator('.fchip-l');
  const text = await box(label);
  expect(done.x + done.width - (text.x + text.width)).toBeLessThan(12);
  const title = await box(row(page, LONG_STATUS).locator('.tk-title'));
  expect(long.x + long.width).toBeLessThanOrEqual(title.x);
  await expect(badge(LONG_STATUS)).toHaveAttribute('title', 'Ready for Code Review');
  const clipped = await badge(LONG_STATUS)
    .locator('.fchip-l')
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(clipped).toBe(true);
});

test('columns line up across groups in both densities and quiet rows say nothing twice', async ({
  page,
}) => {
  await openVolume(page);
  await showDone(page);
  for (const density of ['Comfortable', 'Compact']) {
    await main(page).getByRole('radio', { name: density }).click();
    const edges = await Promise.all(
      [STARTED, UP_NEXT, LONG_STATUS, DONE].map(async (key) =>
        (await boxes(row(page, key), FIXED_CELLS)).map((cell) => Math.round(cell.x)),
      ),
    );
    for (const other of edges.slice(1)) expect(other).toEqual(edges[0]);
  }
  await expect(row(page, UP_NEXT).locator('.why-r')).toHaveText('');
  await expect(row(page, STARTED).locator('.why-r')).toHaveText('');
  await expect(row(page, DONE).locator('.why-r')).toHaveText('');
  await expect(row(page, DONE).locator('.fchip')).toHaveText('Done');
});

test('with the details open, a narrow row still shows everything on hover', async ({ page }) => {
  await openVolume(page);
  const target = row(page, UP_NEXT);
  await target.locator('.ir-main').click();
  await expect(page.getByRole('complementary', { name: `${UP_NEXT} details` })).toBeVisible();
  const other = row(page, 'CP-48006');
  const before = await placed(other, INFO_CELLS);
  const cells = await boxes(other, INFO_CELLS);
  await other.hover();
  const start = other.getByRole('button', { name: 'Start CP-48006' });
  await expect(other.locator('.ir-acts')).toHaveCSS('opacity', '1');
  expect(await placed(other, INFO_CELLS)).toEqual(before);
  const action = await box(start);
  for (const cell of cells) {
    const apart =
      cell.x + cell.width <= action.x ||
      cell.y + cell.height <= action.y ||
      cell.y >= action.y + action.height;
    expect(apart).toBe(true);
  }
});

test('the attention rules open from one line in the side column', async ({ page }) => {
  await openVolume(page);
  const rules = views(page).getByRole('button', { name: 'Attention rules' });
  await expect(rules).toHaveAttribute('aria-expanded', 'false');
  await rules.click();
  await expect(rules).toHaveAttribute('aria-expanded', 'true');
  await expect(views(page)).toContainText('Needs you when a linked chat is waiting on you');
  await rules.click();
  await expect(views(page).getByText('Needs you when a linked chat')).toBeHidden();
});

test('screenshots of the inbox at volume', async ({ page }) => {
  test.skip(!SHOTS, 'Set SPARK_TICKET_SHOTS to a file prefix to capture screenshots.');
  test.setTimeout(180_000);
  await seedTicketVolume();
  await connectTickets(page, ['jira']);
  await page.request.get('/api/tickets/inbox');
  await seedFlowChats([
    { key: 'CP-48002', source: 'jira', status: 'running', spark: 'Pip' },
    { key: 'CP-48003', source: 'jira', status: 'succeeded' },
    { key: 'CP-48007', source: 'jira', status: 'awaiting_approval' },
    {
      key: 'CP-48009',
      source: 'jira',
      status: 'succeeded',
      pull: { number: 341, checks: 'passing' },
    },
    {
      key: 'CP-48011',
      source: 'jira',
      status: 'succeeded',
      pull: { number: 1342, checks: 'failing' },
    },
    { key: 'CP-48030', source: 'jira', status: 'succeeded' },
  ]);
  const until = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString();
  for (const key of ['CP-48011', 'CP-48027']) {
    await page.request.put(`/api/tickets/jira/${key}/snooze`, {
      data: { until, rules: ['pr-checks'] },
    });
  }
  await openTickets(page);
  await expect(row(page, UP_NEXT)).toBeVisible({ timeout: 15_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shoot = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.resolve(`${SHOTS}-${name}.png`) });
  };
  const skin = (theme: string) =>
    page.evaluate((value) => (document.documentElement.dataset.skin = value), theme);

  for (const width of [1280, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await skin(theme);
      await page.mouse.move(0, 0);
      await shoot(`${width}-${theme}`);
    }
  }
  await skin('light');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await row(page, 'CP-48006').hover();
  await shoot('1440-hover');
  await row(page, 'CP-48003').hover();
  await shoot('1440-open-chat-hover');
  await main(page).getByRole('radio', { name: 'Compact' }).click();
  await row(page, 'CP-48006').hover();
  await shoot('1440-compact-hover');
  await main(page).getByRole('radio', { name: 'Comfortable' }).click();
  await views(page)
    .getByRole('button', { name: /^Done recently/ })
    .click();
  await page.mouse.move(0, 0);
  await shoot('1440-done');
  await views(page)
    .getByRole('button', { name: /^Inbox/ })
    .click();
  await row(page, UP_NEXT).locator('.ir-main').click();
  await expect(page.getByRole('complementary', { name: `${UP_NEXT} details` })).toBeVisible();
  await row(page, 'CP-48006').hover();
  await shoot('1440-detail-hover');
  await skin('dark');
  await shoot('1440-detail-hover-dark');
  await skin('light');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await row(page, 'CP-48006').hover();
  await shoot('1280-detail-hover');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('searchbox').fill('page');
  await expect(main(page).locator('li.irow').first()).toBeVisible();
  await main(page).locator('li.irow').nth(1).hover();
  await shoot('1280-search-hover');
});
