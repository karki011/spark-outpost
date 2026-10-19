import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { GOOGLE_TESTING_LINE, calendarStatusSchema } from '../../packages/contracts/src/index.ts';
import { THEMES } from '../../scripts/contrast/theme.ts';
import { resetTestDatabase } from './database.ts';
import { readCalendarClock } from './fake-calendar-clock.ts';
import { calendarCard, chooseCalendars, sourceMenu } from './calendar-card.ts';
import { animationsSettled } from './settle.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.CALENDAR_SHOTS ?? '';
const MINUTE = 60_000;
const MAC = 'Mac Calendar';
const card = calendarCard;
const fakeNow = () => Date.now() + readCalendarClock(FAKE_CALENDAR_STATE);
const trigger = (page: Page) => card(page).getByRole('button', { name: `Options for ${MAC}` });

async function status(page: Page) {
  const response = await page.request.get('/api/calendar/status');
  return calendarStatusSchema.parse(await response.json());
}

async function openCard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  const head = card(page).locator('button.pc-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(card(page).locator('.cal-body')).toBeVisible();
}

async function connect(page: Page) {
  const connected = await page.request.post('/api/calendar/connect', { data: {} });
  expect(connected.ok()).toBe(true);
}

async function axeInEveryTheme(page: Page, include: string) {
  for (const theme of THEMES) {
    const scheme = theme === 'system-dark' ? 'dark' : 'light';
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((skin) => {
      if (skin.startsWith('system')) delete document.documentElement.dataset.skin;
      else document.documentElement.dataset.skin = skin;
    }, theme);
    await animationsSettled(page);
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include(include)
      .analyze();
    expect(scan.violations, theme).toEqual([]);
  }
}

async function shoot(page: Page, name: string, target = card(page)) {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => delete document.documentElement.dataset.skin);
    await animationsSettled(page);
    await target.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
}

test.beforeEach(async () => {
  const anchor = Math.floor(fakeNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ authorization: 'notDetermined', anchor }));
  await resetTestDatabase({ onboarded: true });
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('offers Mac Calendar and Google side by side before anything is connected', async ({
  page,
}) => {
  await openCard(page);
  const mac = card(page).getByRole('region', { name: MAC });
  const google = card(page).getByRole('region', { name: 'Google Calendar' });
  await expect(card(page)).toContainText('See today’s meetings, get a nudge before they start');
  await expect(mac).toContainText('Every calendar already on this Mac');
  await expect(mac.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(google.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(google).toContainText(GOOGLE_TESTING_LINE);
  await expect(card(page)).toContainText('Read-only by default.');
  await expect(card(page).getByRole('switch', { name: 'Let agents read my calendar' })).toHaveCount(
    0,
  );
  await shoot(page, 'empty');
  await axeInEveryTheme(page, '[data-connector="calendar"]');
});

test('stacks the choice tiles on a narrow window', async ({ page }) => {
  await openCard(page);
  await animationsSettled(page);
  const wide = await card(page).getByRole('region', { name: MAC }).boundingBox();
  const beside = await card(page).getByRole('region', { name: 'Google Calendar' }).boundingBox();
  expect(beside!.y).toBeCloseTo(wide!.y, 0);
  await page.setViewportSize({ width: 400, height: 900 });
  await animationsSettled(page);
  const mac = await card(page).getByRole('region', { name: MAC }).boundingBox();
  const google = await card(page).getByRole('region', { name: 'Google Calendar' }).boundingBox();
  expect(google!.y).toBeGreaterThan(mac!.y + mac!.height - 1);
});

test('opens the source menu from the keyboard and returns focus when it closes', async ({
  page,
}) => {
  await connect(page);
  await openCard(page);
  await trigger(page).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: `Options for ${MAC}` });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Choose calendars',
    'Agents can edit',
    'Disconnect…',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Choose calendars' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Agents can edit' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Disconnect…' })).toBeFocused();
  await shoot(page, 'menu', page.locator('body'));
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger(page)).toBeFocused();
  await expect(card(page)).toBeVisible();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const include = card(page).getByRole('checkbox', { name: 'Include Spark Work' });
  await expect(include).toBeFocused();
  await expect(card(page).getByRole('group', { name: 'Choose calendars' })).toBeVisible();
});

test('confirms Disconnect in a dialog that traps focus and cancels with Esc', async ({ page }) => {
  await connect(page);
  await openCard(page);
  await sourceMenu(page, MAC, 'Disconnect…');
  const dialog = page.getByRole('alertdialog', { name: `Disconnect ${MAC}?` });
  await expect(dialog).toContainText('Nothing in Calendar changes');
  await expect(dialog).toContainText('Calendars access in System Settings');
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Disconnect', exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await shoot(page, 'disconnect-dialog', page.locator('body'));
  await axeInEveryTheme(page, '.cal-confirm');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger(page)).toBeFocused();
  await expect(card(page).getByRole('region', { name: MAC })).toBeVisible();
  expect((await status(page)).connected).toBe(true);

  await sourceMenu(page, MAC, 'Disconnect…');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(trigger(page)).toBeFocused();

  await sourceMenu(page, MAC, 'Disconnect…');
  await confirm.click();
  await expect(card(page).getByRole('button', { name: 'Connect', exact: true })).toBeFocused();
  expect((await status(page)).connected).toBe(false);
});

test('opens the source menu and Disconnect dialog above onboarding', async ({ page }) => {
  await resetTestDatabase({ onboarded: false, connected: ['claude'] });
  await connect(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Bring in your tools' })).toBeVisible();
  await card(page).locator('button.pc-head').click();
  await sourceMenu(page, MAC, 'Disconnect…');
  const dialog = page.getByRole('alertdialog', { name: `Disconnect ${MAC}?` });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger(page)).toBeFocused();
});

test('dims a hidden calendar and passes axe in every theme once connected', async ({ page }) => {
  await connect(page);
  await openCard(page);
  await chooseCalendars(page, MAC);
  await card(page).getByRole('checkbox', { name: 'Include Spark Family' }).uncheck();
  await card(page).getByRole('button', { name: 'Done' }).click();
  const family = card(page).getByRole('listitem').filter({ hasText: 'Spark Family' });
  await expect(family).toContainText('hidden');
  await expect(card(page)).toContainText(/1 calendar/);
  await shoot(page, 'connected');
  await axeInEveryTheme(page, '[data-connector="calendar"]');
});
