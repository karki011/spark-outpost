import AxeBuilder from '@axe-core/playwright';
import type { RemoteSession } from '../../packages/contracts/src/remote.ts';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb, resetTestDatabase } from './database.ts';

const AFTERNOON = new Date('2026-10-17T16:30:50-04:00');
const HOUR = 60 * 60 * 1000;

test.use({ locale: 'en-US', timezoneId: 'America/New_York' });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const clock = (page: Page) => rail(page).locator('.rail-clock');
const today = (page: Page) => page.getByRole('main', { name: 'Today' });

async function openAt(page: Page, time = AFTERNOON) {
  await page.clock.install({ time });
  await page.goto('/');
  await expect(clock(page)).toBeVisible();
}

async function width(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().width);
}

test('shows the time below Settings without widening the rail', async ({ page }) => {
  await openAt(page);
  const button = rail(page).getByRole('button', { name: '4:30 PM. Open Today', exact: true });
  await expect(button).toHaveText('04:30 PM');
  await expect(rail(page).locator('[aria-live]')).toHaveCount(0);
  await expect(clock(page).locator('.rail-clock-period')).toHaveText('PM');

  const settings = await rail(page).getByRole('button', { name: 'Settings' }).boundingBox();
  const face = await clock(page).boundingBox();
  const bar = await rail(page).boundingBox();
  expect(face!.y).toBeGreaterThanOrEqual(settings!.y + settings!.height);
  expect(Math.abs(face!.x + face!.width / 2 - (settings!.x + settings!.width / 2))).toBeLessThan(1);
  expect(face!.x).toBeGreaterThanOrEqual(bar!.x);
  expect(face!.x + face!.width).toBeLessThanOrEqual(bar!.x + bar!.width);
  expect(face!.height).toBeGreaterThanOrEqual(24);
  const fits = await clock(page).evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);

  const withClock = await width(page, '.rail');
  await clock(page).evaluate((element) => element.remove());
  expect(await width(page, '.rail')).toBe(withClock);
});

async function seedPlanRing() {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      `INSERT INTO provider_model_access (workspace_id, provider, method, account_kind, account_label)
       VALUES ($1, 'claude', 'cli', 'account', 'Claude Max')
       ON CONFLICT (workspace_id, provider) DO NOTHING`,
      [workspaceId],
    );
    await db.query(
      `INSERT INTO provider_plan_limits
         (workspace_id, provider, plan_window, account_label, used, resets_at, limited, observed_at)
       VALUES ($1, 'claude', 'five_hour', 'Claude Max', 0.8, $2, false, now())`,
      [workspaceId, new Date(Math.max(Date.now(), AFTERNOON.getTime()) + 48 * HOUR)],
    );
  } finally {
    await db.end();
  }
}

for (const height of [600, 700]) {
  test(`stays in view in a ${height}px tall window`, async ({ page }) => {
    await seedPlanRing();
    await page.setViewportSize({ width: 1000, height });
    await openAt(page);
    await expect(rail(page).getByRole('button', { name: 'Claude plan limits' })).toBeVisible();
    await expect(clock(page)).toBeInViewport({ ratio: 1 });
    expect(await width(page, '.rail')).toBe(70);

    await clock(page).focus();
    await page.keyboard.press('Shift+Tab');
    const settings = rail(page).getByRole('button', { name: 'Settings' });
    await expect(settings).toBeFocused();
    await expect(settings).toBeInViewport({ ratio: 0.99 });
    const above = await clock(page).boundingBox();
    const box = await settings.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(above!.y + 1);
  });
}

test('names the full date in its tooltip and opens Today on click', async ({ page }) => {
  await openAt(page);
  await clock(page).hover();
  await page.clock.runFor(500);
  await expect(page.getByRole('tooltip')).toHaveText('Saturday, October 17, 2026 at 4:30 PM');
  await clock(page).click();
  await expect(today(page)).toBeVisible();
});

test('opens Today from the keyboard with a visible focus ring', async ({ page }) => {
  await openAt(page);
  await rail(page).getByRole('button', { name: 'Settings' }).focus();
  await page.keyboard.press('Tab');
  await expect(clock(page)).toBeFocused();
  const outline = await clock(page).evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(today(page)).toBeVisible();

  await rail(page).getByRole('button', { name: 'Home', exact: true }).click();
  await clock(page).focus();
  await page.keyboard.press('Space');
  await expect(today(page)).toBeVisible();
});

test('flips the minute when it changes and the hour only when the hour changes', async ({
  page,
}) => {
  await openAt(page, new Date('2026-10-17T16:58:50-04:00'));
  await expect(clock(page).locator('.flip')).toHaveCount(0);

  await page.clock.runFor(11_000);
  await expect(clock(page)).toHaveText('04:59 PM');
  await expect(clock(page).locator('.flip')).toHaveText(['59']);
  const name = await clock(page)
    .locator('.flip')
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(name).toBe('rail-clock-flip');

  await page.clock.runFor(60_000);
  await expect(clock(page)).toHaveText('05:00 PM');
  await expect(clock(page).locator('.flip')).toHaveText(['05', '00']);
});

test('changes the digits without motion under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAt(page);
  await page.clock.runFor(11_000);
  await expect(clock(page)).toHaveText('04:31 PM');
  const name = await clock(page)
    .locator('.flip')
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(name).toBe('none');
});

test('has no serious accessibility problems in the rail', async ({ page }) => {
  await openAt(page);
  const results = await new AxeBuilder({ page })
    .include('nav[aria-label="Main"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});

test('hides with the rail on a phone-width window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: AFTERNOON });
  await page.goto('/');
  await expect(rail(page).getByRole('button', { name: 'Home', exact: true })).toBeVisible();
  await expect(clock(page)).toHaveCount(0);
});

test('shows the time without a Today button on a paired device', async ({ page }) => {
  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as RemoteSession;
    await route.fulfill({ response, json: { ...session, remote: true } });
  });
  await openAt(page);
  await expect(clock(page)).toHaveText('04:30 PM');
  await expect(rail(page).getByRole('button', { name: /Open Today/ })).toHaveCount(0);
});

test.describe('in a 24-hour locale', () => {
  test.use({ locale: 'en-GB' });

  test('shows the 24-hour time with no day period', async ({ page }) => {
    await openAt(page);
    const button = rail(page).getByRole('button', { name: '16:30. Open Today', exact: true });
    await expect(button).toHaveText('16:30');
    await expect(clock(page).locator('.rail-clock-period')).toHaveCount(0);
  });
});
