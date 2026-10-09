import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { chatMenuButton } from './header-menu.ts';

type LazyPart = 'Analytics' | 'Tickets' | 'xterm-terminal' | 'DayCalendarGrid';

const partUrl = (part: LazyPart) => new RegExp(`/${part}(-[\\w-]+\\.js|\\.tsx?)(\\?.*)?$`);

async function hold(page: Page, part: LazyPart): Promise<() => void> {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(partUrl(part), async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

test('Analytics and Tickets show their outline until their code arrives @packaged', async ({
  page,
}) => {
  const releaseAnalytics = await hold(page, 'Analytics');
  const releaseTickets = await hold(page, 'Tickets');
  await page.goto('/');
  await expect(rail(page)).toBeVisible();

  await rail(page)
    .getByRole('button', { name: /^Analytics/ })
    .click();
  const analytics = page.getByRole('main');
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
  await expect(analytics).toHaveAttribute('aria-busy', 'true');
  await expect(analytics.locator('.an-skel-card').first()).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  releaseAnalytics();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('main')).not.toHaveAttribute('aria-busy', 'true');

  await rail(page)
    .getByRole('button', { name: /^Tickets/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loading tickets');
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  releaseTickets();
  await expect(page.getByRole('searchbox')).toBeVisible();

  await page.keyboard.press('Tab');
  await rail(page)
    .getByRole('button', { name: /^Analytics/ })
    .click();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
});

test('the calendar keeps its size and focus while its code arrives @packaged', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const releaseCalendar = await hold(page, 'DayCalendarGrid');
  await page.goto('/');
  await rail(page)
    .getByRole('button', { name: /^Analytics/ })
    .click();
  await page.getByRole('radio', { name: /^Custom/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a custom date range' });
  await expect(dialog).toBeVisible();
  const outline = dialog.locator('.day-grid-skel');
  await expect(outline).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('Loading the calendar');
  await expect(dialog.locator('.an-cal-preset').first()).toBeFocused();
  const before = await outline.boundingBox();

  releaseCalendar();
  const grid = dialog.locator('.rdp-month').first();
  await expect(grid).toBeVisible();
  await expect(outline).toHaveCount(0);
  const after = await dialog.locator('.day-grid').boundingBox();
  expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeLessThanOrEqual(4);
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(4);
  await expect(dialog.locator('.an-cal-preset').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /^Custom/ })).toBeFocused();
});

test('the terminal shortcut opens the dock at once and focus lands in the terminal when it loads @packaged', async ({
  page,
}) => {
  const releaseTerminal = await hold(page, 'xterm-terminal');
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const button = chatMenuButton(page);
  await expect(button).toBeVisible();

  await page.keyboard.press('Control+Backquote');
  const dock = page.getByRole('region', { name: 'Terminal' });
  await expect(dock).toBeVisible();
  await expect(dock.locator('.term-skel')).toBeVisible();
  await expect(dock.locator('.xterm')).toHaveCount(0);

  releaseTerminal();
  await expect(dock.locator('.xterm')).toBeVisible();
  await expect(dock.locator('.term-skel')).toHaveCount(0);
  await expect(dock.locator('.term-light.open')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.xterm'))))
    .toBe(true);
  await page.keyboard.type('echo "lazy:$((40 + 2))"');
  await page.keyboard.press('Enter');
  await expect(dock.locator('.xterm-accessibility')).toContainText('lazy:42');

  await page.keyboard.press('Control+Backquote');
  await expect(dock).toHaveCount(0);
  await expect(button).toBeFocused();
});
