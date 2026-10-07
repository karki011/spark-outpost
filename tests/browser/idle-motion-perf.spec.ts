import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island, openIsland } from './island-home-desktop.ts';
import { idleBusyPercent, PRODUCTION, writeReport } from './perf-probe.ts';
import { seedChats } from './sidebar-seed.ts';

test.use({ trace: 'off' });

const FOCUSED_LIMIT = PRODUCTION ? 5 : 25;
const UNFOCUSED_LIMIT = PRODUCTION ? 2 : 10;
const LIVE_LIMIT = PRODUCTION ? 15 : 80;
const REST_WAIT_MS = 5_000;

const motion = (page: Page) => page.evaluate(() => document.documentElement.dataset.motion ?? null);

async function quietChats() {
  await seedChats(
    Array.from({ length: 12 }, (_, index) => ({
      title: `Finished chat ${index + 1}`,
      run: { status: 'succeeded' },
      minutesAgo: index * 30,
    })),
  );
}

async function openScreen(page: Page, name: string) {
  if (name === 'Settings') {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog').last().getByRole('tab', { name: 'Models' }).click();
    return;
  }
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
}

async function blurWindow(page: Page, focused: boolean) {
  await page.evaluate((on) => window.dispatchEvent(new Event(on ? 'focus' : 'blur')), focused);
}

test('idle blobs rest while the app is quiet and stop when the window loses focus', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await resetTestDatabase({ onboarded: true });
  await quietChats();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const screens: Record<string, { live: number; rest: number; unfocused: number }> = {};
  for (const name of ['Home', 'Chats', 'Docs', 'Phone', 'Settings']) {
    await openScreen(page, name);
    await page.mouse.move(700, 450);
    await expect.poll(() => motion(page)).toBe('live');
    const live = await idleBusyPercent(page, 1_500);
    await page.waitForTimeout(REST_WAIT_MS);
    await expect.poll(() => motion(page)).toMatch(/rest/);
    const rest = await idleBusyPercent(page, 12_000);
    await expect.poll(() => motion(page)).toMatch(/rest|live/);
    await blurWindow(page, false);
    await expect.poll(() => motion(page)).toBe('paused');
    const unfocused = await idleBusyPercent(page, 3_000);
    await blurWindow(page, true);
    await expect.poll(() => motion(page)).toBe('live');
    screens[name] = { live, rest, unfocused };
    if (name === 'Settings') await page.keyboard.press('Escape');
  }

  const islandPage = await page.context().newPage();
  await fakeHomeDesktop(islandPage);
  await openIsland(islandPage);
  await expect(island(islandPage)).toHaveAttribute('data-view', 'peek');
  await islandPage.mouse.move(640, 600);
  await expect.poll(() => motion(islandPage)).toBe('paused');
  await islandPage.waitForTimeout(1_000);
  const islandResting = await idleBusyPercent(islandPage, 3_000);
  await islandPage.close();

  const summary = { screens, islandResting };
  writeReport('idle-motion', summary);
  test.info().annotations.push({ type: 'idle motion', description: JSON.stringify(summary) });
  for (const [name, busy] of Object.entries(screens)) {
    expect.soft(busy.live, `${name} while in use`).toBeLessThan(LIVE_LIMIT);
    expect.soft(busy.rest, `${name} focused at rest`).toBeLessThan(FOCUSED_LIMIT);
    expect.soft(busy.unfocused, `${name} unfocused`).toBeLessThan(UNFOCUSED_LIMIT);
  }
  expect(islandResting).toBeLessThan(FOCUSED_LIMIT);
});
