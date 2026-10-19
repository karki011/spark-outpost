import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;

function dayKey(at: number): string {
  const day = new Date(at);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`;
}

const today = (page: Page) => page.getByRole('main', { name: 'Today' });
const cell = (page: Page) =>
  today(page)
    .getByRole('grid')
    .locator(`[data-date="${dayKey(apiNow())}"]`);
const scheduled = (page: Page) => today(page).getByRole('complementary', { name: 'Scheduled' });

async function recordOpens(page: Page) {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { opened });
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
  });
}

const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { opened: string[] }).opened);

async function openToday(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  await expect(today(page).getByRole('grid')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor, busy: true }));
  await matchApiClock(page);
  await recordOpens(page);
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('the day panel shows a few people, never a room, and copies an email', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openToday(page);
  const card = scheduled(page).locator('.rl-card', { hasText: 'Launch review' });
  await expect(card).toContainText('Agenda: pricing page review and launch checklist.');
  await expect(card).not.toContainText('-::~');
  await expect(card).not.toContainText('Meeting ID');
  const people = card.getByRole('list', { name: 'People' });
  await expect(people.getByRole('listitem')).toHaveCount(3);
  await expect(people).toContainText('+4 more');
  await expect(people).not.toContainText('Bay Village');
  await expect(card.locator('.cal-where')).toHaveText('33 Arch St-14-Bay Village (2)');

  const alexandra = people.getByRole('button', { name: /^Alexandra Wong-Fitzgerald, / });
  await expect(alexandra).toHaveAttribute('title', 'alexandra.wong-fitzgerald@cloudzero.example');
  const name = alexandra.locator('.cal-person-name');
  const box = await name.boundingBox();
  const cardBox = await card.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
  await alexandra.click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'alexandra.wong-fitzgerald@cloudzero.example',
  );
  await expect(page.getByRole('dialog')).toBeHidden();

  const rail = await scheduled(page).boundingBox();
  expect(rail!.width).toBeGreaterThanOrEqual(330);
});

test('the popover links the description, collapses the dial-ins and joins in the window', async ({
  page,
}) => {
  await openToday(page);
  await scheduled(page)
    .getByRole('button', { name: /^Launch review, / })
    .click();
  const popover = page.getByRole('dialog', { name: 'Launch review' });
  await expect(popover).toContainText('Agenda: pricing page review');
  await expect(popover).not.toContainText('-::~');
  await popover.getByRole('button', { name: 'Open docs.example.com in your browser' }).click();
  const details = popover.locator('details');
  await expect(details).not.toHaveAttribute('open');
  await details.locator('summary').click();
  await expect(
    popover.getByRole('button', { name: /^Copy phone number \+1 312 626 6799/ }),
  ).toBeVisible();
  await popover.getByRole('button', { name: 'Join Zoom Launch review' }).click();
  expect(await opened(page)).toEqual([
    'https://docs.example.com/d/launch',
    'https://cloudzero.zoom.us/j/81234567890?pwd=abc123',
  ]);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
});

test('a street address opens in Maps and a room shows as the location', async ({ page }) => {
  await openToday(page);
  const lunch = scheduled(page).locator('.rl-card', { hasText: 'Lunch' });
  await expect(lunch.locator('.cal-where')).toContainText('1 Infinite Loop, Cupertino');
  await scheduled(page)
    .getByRole('button', { name: /^Planning offsite, / })
    .click();
  const offsite = page.getByRole('dialog', { name: 'Planning offsite' });
  await offsite.getByRole('button', { name: /in Maps$/ }).click();
  expect(await opened(page)).toEqual([
    'https://maps.apple.com/?q=33%20Arch%20St%2C%20Boston%2C%20MA%2002110',
  ]);
  await page.keyboard.press('Escape');
  await scheduled(page)
    .getByRole('button', { name: /^Design crit, / })
    .click();
  const design = page.getByRole('dialog', { name: 'Design crit' });
  await expect(design.locator('.cal-where')).toHaveText('33 Arch St-14-Bay Village (2)');
  await expect(design.getByRole('list', { name: 'People' })).not.toContainText('Bay Village');
});

test('N more lists the hidden events on hover and focus, and opens one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await openToday(page);
  const more = cell(page).getByRole('button', { name: /^\d+ more events on / });
  await more.hover();
  const list = page.getByRole('group', { name: /^\d+ more events on / });
  await expect(list).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await list.getByRole('button', { name: /Week wrap-up/ }).click();
  await expect(page.getByRole('dialog', { name: 'Week wrap-up' })).toBeVisible();
  await page.keyboard.press('Escape');

  await cell(page).focus();
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await expect(list).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(list.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await expect(cell(page)).toHaveAttribute('aria-selected', 'true');
});

test('the day panel resizes by dragging and with the keyboard, and remembers it', async ({
  page,
}) => {
  await openToday(page);
  const handle = today(page).getByRole('separator', { name: 'Resize day panel' });
  await expect(handle).toHaveAttribute('aria-valuenow', '352');
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 200);
  await page.mouse.down();
  await page.mouse.move(box!.x - 120, box!.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', /^4[67]\d$/);
  const wide = Number(await handle.getAttribute('aria-valuenow'));
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', String(wide - 16));
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', String(wide - 16));
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '352');

  await page.setViewportSize({ width: 820, height: 1000 });
  await expect(handle).toBeHidden();
});

test('Day fills the window and keeps titles readable beside a long block', async ({ page }) => {
  await openToday(page);
  await today(page).getByRole('radio', { name: 'Day' }).click();
  const main = today(page).getByRole('region', { name: 'Events' });
  const box = await main.boundingBox();
  expect(box!.width).toBeGreaterThan(900);
  const short = today(page).getByRole('button', { name: /^Myra - Parent Teacher Conference, / });
  await expect(short).toHaveAccessibleName(/clashes with/);
  const title = short.locator('b');
  const titleBox = await title.boundingBox();
  expect(titleBox!.width).toBeGreaterThan(120);
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});

test('ended meetings are dimmed everywhere and ongoing ones stay full strength', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await openToday(page);
  const chip = (title: string) => cell(page).locator('.mo-ev', { hasText: title });
  await expect(chip('Earlier sync')).toHaveAttribute('data-ended', 'true');
  await expect(chip('Ongoing review')).not.toHaveAttribute('data-ended');
  const card = (title: string) => scheduled(page).locator('.rl-card', { hasText: title });
  await expect(card('Earlier sync')).toHaveAttribute('data-past', 'true');
  await expect(card('Ongoing review')).not.toHaveAttribute('data-past');
  await today(page).getByRole('radio', { name: 'Day' }).click();
  await expect(today(page).getByRole('button', { name: /^Earlier sync, / })).toHaveAttribute(
    'data-ended',
    'true',
  );
  await expect(today(page).getByRole('button', { name: /^Ongoing review, / })).not.toHaveAttribute(
    'data-ended',
  );
});

const THEMES = [
  'dark',
  'light',
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'contrast',
];

async function contrastProblems(page: Page, screen: string) {
  const found: string[] = [];
  for (const theme of THEMES) {
    await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
    await animationsSettled(page);
    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    for (const violation of results.violations) {
      if (violation.impact === 'serious' || violation.impact === 'critical') {
        found.push(
          `${screen} ${theme}: ${violation.id} ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
        );
      }
    }
  }
  return found;
}

test('the busy popover and the more list read well in every theme', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openToday(page);
  await scheduled(page)
    .getByRole('button', { name: /^Launch review, / })
    .click();
  const popover = page.getByRole('dialog', { name: 'Launch review' });
  await popover.locator('summary').click();
  const found = await contrastProblems(page, 'popover');
  await page.keyboard.press('Escape');
  await cell(page)
    .getByRole('button', { name: /^\d+ more events on / })
    .hover();
  await expect(page.getByRole('group', { name: /^\d+ more events on / })).toBeVisible();
  found.push(...(await contrastProblems(page, 'more list')));
  expect(found).toEqual([]);
});
