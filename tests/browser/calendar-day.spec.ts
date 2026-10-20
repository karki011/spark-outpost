import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;
const today = (page: Page) => page.getByRole('main', { name: 'Today' });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor, day: true }));
  await matchApiClock(page);
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

async function openDay(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  await today(page).getByRole('radio', { name: 'Day' }).click();
}

async function linesStayInside(block: Locator) {
  const boxes = await block.evaluate((element) => {
    const outer = element.getBoundingClientRect();
    const lines = [...element.children]
      .filter((child) => getComputedStyle(child).display !== 'none')
      .filter((child) => !child.classList.contains('tl-clash'))
      .map((child) => child.getBoundingClientRect());
    return { outer: { top: outer.top, bottom: outer.bottom }, lines };
  });
  for (const [index, line] of boxes.lines.entries()) {
    expect(line.top).toBeGreaterThanOrEqual(boxes.outer.top);
    expect(line.bottom).toBeLessThanOrEqual(boxes.outer.bottom + 0.5);
    const next = boxes.lines[index + 1];
    if (next) expect(next.top).toBeGreaterThanOrEqual(line.bottom - 0.5);
  }
  return boxes.lines.length;
}

test('short meetings lay out by height and never draw lines over each other', async ({ page }) => {
  await openDay(page);
  const standup = today(page).getByRole('button', { name: /^Team Cirrus Standup, / });
  const pickup = today(page).getByRole('button', { name: /^Bus pickup, / });
  const quick = today(page).getByRole('button', { name: /^Quick check-in/ });
  const review = today(page).getByRole('button', { name: /^Design review, / });
  await expect(standup).toHaveAttribute('data-rows', '2');
  await expect(standup.locator('.tl-clash')).toHaveAttribute('title', 'Clashes with Bus pickup');
  await expect(standup.locator('.tl-tags')).toHaveCount(0);
  expect(await linesStayInside(standup)).toBe(2);
  expect(await linesStayInside(pickup)).toBe(2);
  await expect(quick).toHaveAttribute('data-rows', '1');
  await expect(quick.locator('.tl-one')).toHaveCSS('text-overflow', 'ellipsis');
  expect(await linesStayInside(quick)).toBe(1);
  await expect(review).toHaveAttribute('data-rows', '3');
  expect(await linesStayInside(review)).toBe(2);
});

test('a selected meeting shows in the accent text colour, with a ring only for the keyboard', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDay(page);
  const standup = today(page).getByRole('button', { name: /^Team Cirrus Standup, / });
  await standup.click();
  await expect(standup).toHaveAttribute('aria-expanded', 'true');
  const style = await standup.evaluate((element) => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-text');
    const probe = document.createElement('span');
    probe.style.color = accent;
    document.body.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    const own = getComputedStyle(element);
    return {
      shadow: own.boxShadow,
      outline: own.outlineStyle,
      title: getComputedStyle(element.querySelector('b')!).color,
      meta: getComputedStyle(element.querySelector('.tl-meta')!).color,
      want,
    };
  });
  expect(style.shadow).toBe('none');
  expect(style.outline).toBe('none');
  expect(style.title).toBe(style.want);
  expect(style.meta).toBe(style.want);
  const pickup = today(page).getByRole('button', { name: /^Bus pickup, / });
  await today(page)
    .getByRole('button', { name: /^Quick check-in/ })
    .focus();
  await page.keyboard.press('Shift+Tab');
  await expect(pickup).toBeFocused();
  await expect(pickup).toHaveCSS('outline-style', 'solid');
});

for (const theme of ['light', 'dark']) {
  test(`HTML notes read as text with bullets and one safe link in the ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript((saved) => {
      localStorage.setItem('spark-outpost.theme', saved);
      const opened: string[] = [];
      Object.assign(window, { opened });
      window.open = (url?: string | URL) => {
        opened.push(String(url));
        return null;
      };
    }, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDay(page);
    await today(page)
      .getByRole('button', { name: /^Team Cirrus Standup, / })
      .click();
    const panel = today(page).getByRole('region', { name: 'Team Cirrus Standup' });
    const agenda = panel.locator('.cal-agenda');
    await expect(agenda).toContainText('Setting aside 15 minutes');
    await expect(agenda.getByRole('listitem')).toHaveText([
      'What did you do yesterday?',
      'What are your goals for today?',
      'Are there any blockers?',
    ]);
    await expect(agenda).toContainText("Tom's & Ann’s notes");
    await expect(agenda).toContainText('Do not link');
    await expect(agenda).not.toContainText('<');
    await expect(agenda).not.toContainText('alert');
    await expect(agenda.locator('a, img, script')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(
      results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
    ).toEqual([]);
    const shots = process.env.SPARK_DAY_SHOTS;
    if (shots) {
      await page.mouse.move(0, 0);
      await today(page).screenshot({ path: `${shots}/day-${theme}.png` });
      await panel.screenshot({ path: `${shots}/panel-${theme}.png` });
    }
    await agenda.getByRole('button', { name: 'Open acme.atlassian.net in your browser' }).click();
    expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual([
      'https://acme.atlassian.net/jira/boards/1',
    ]);
  });
}

test('Join is quiet before its window, primary inside it and Ended after', async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { opened });
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDay(page);
  const shots = process.env.SPARK_DAY_SHOTS;
  const panel = (title: string) => today(page).getByRole('region', { name: title });
  const opened = () => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

  await today(page)
    .getByRole('button', { name: /^Team Cirrus Standup, / })
    .click();
  const early = panel('Team Cirrus Standup').getByRole('button', {
    name: 'Join Zoom Team Cirrus Standup',
  });
  await expect(early).toHaveAttribute('aria-disabled', 'true');
  await expect(early).toHaveAccessibleDescription(/^Opens at /);
  await expect(early).toHaveAttribute('title', /^Join opens at /);
  await early.click({ force: true });
  expect(await opened()).toEqual([]);
  if (shots)
    await panel('Team Cirrus Standup')
      .locator('.td-join')
      .screenshot({ path: `${shots}/join-early.png` });

  await today(page)
    .getByRole('button', { name: /^Live review, / })
    .click();
  const live = panel('Live review').getByRole('button', { name: 'Join Google Meet Live review' });
  await expect(live).toHaveClass(/\bprimary\b/);
  if (shots)
    await panel('Live review')
      .locator('.td-join')
      .screenshot({ path: `${shots}/join-open.png` });
  await live.click();
  expect(await opened()).toEqual(['https://meet.google.com/abc-defg-hij']);

  await today(page)
    .getByRole('button', { name: /^Morning sync, / })
    .click();
  await expect(
    panel('Morning sync').getByRole('button', { name: 'Morning sync has ended' }),
  ).toHaveText('Ended');
  await expect(panel('Morning sync').locator('.td-join')).toContainText('acme.zoom.us');
  if (shots)
    await panel('Morning sync')
      .locator('.td-join')
      .screenshot({ path: `${shots}/join-ended.png` });
});
