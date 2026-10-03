import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  allowEdit,
  card,
  CREW_REQUEST,
  crewChat,
  crewRepo,
  failingCheck,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const SHOTS = process.env.TV_SHOTS ?? '';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('tv-fresh')) return;
    sessionStorage.setItem('tv-fresh', '1');
    localStorage.removeItem('spark-outpost.agent-tv');
  });
});

test.afterEach(() => repo.remove());

const tvOf = (page: Page) => page.getByRole('dialog', { name: 'Agent TV' });
const blob = (page: Page, role: string) => tvOf(page).locator(`.tv-n[data-role="${role}"]`).last();
const details = (page: Page) => tvOf(page).getByRole('group', { name: / details$/ });

async function blockOf(page: Page, role: string) {
  const id = await blob(page, role).getAttribute('data-agent');
  return page.locator(`[id="agent-${id}"]`);
}

async function scrollThread(page: Page, to: 'top' | 'bottom') {
  await page
    .locator('.thread')
    .evaluate((element, end) => (element.scrollTop = end === 'top' ? 0 : element.scrollHeight), to);
}

async function editWaiting(page: Page) {
  await crewChat(page, repo, 'Ask before edits');
  await send(page, `${CREW_REQUEST} #build #crew`);
  const edit = card(page, /Change a file\?/);
  await expect(edit).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Agent TV' }).click();
  await expect(tvOf(page)).toBeVisible();
  await settled(page);
  return edit;
}

async function settled(page: Page) {
  await tvOf(page).evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, `tv-${name}.png`) });
}

test('clicking a blob bounces it and shows its status, Go to scrolls, Esc steps back', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const edit = await editWaiting(page);
  const tv = tvOf(page);

  await blob(page, 'builder').click();
  const bubble = details(page);
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Builder');
  await expect(bubble).toContainText('Opus 5.5 · high');
  await expect(blob(page, 'builder')).toHaveAttribute('aria-expanded', 'true');

  await scrollThread(page, 'top');
  await bubble.getByRole('button', { name: 'Go to' }).click();
  await expect(bubble).toBeHidden();
  await expect(await blockOf(page, 'builder')).toBeInViewport();

  await blob(page, 'jev').click();
  await expect(bubble).toContainText(/Dispatcher(Picked|Sent \w+:|Noted:) /);
  await expect(bubble).toContainText('router');
  await page.keyboard.press('Escape');
  await expect(bubble).toBeHidden();
  await expect(tv).toBeVisible();

  const ask = tv.getByRole('button', { name: /Needs you: change notes\.txt\?/ });
  await expect(ask).toBeVisible();
  await scrollThread(page, 'top');
  await ask.click();
  await expect(edit).toBeInViewport();

  await page.keyboard.press('Escape');
  await expect(tv).toBeHidden();
  await expect(page.getByRole('button', { name: 'Agent TV' })).toBeFocused();
});

test('keyboard: Tab reaches the blobs, Enter opens the bubble, Enter again goes to the agent', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await editWaiting(page);
  const builder = blob(page, 'builder');
  await builder.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(blob(page, 'jev')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(builder).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(details(page)).toBeVisible();
  await scrollThread(page, 'top');
  await page.keyboard.press('Enter');
  await expect(await blockOf(page, 'builder')).toBeInViewport();
});

test('a dispatch sends a packet and a line of chatter, and a waiting agent asks for you', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Auto-edit');
  await failingCheck(page, repo.root);
  await send(page, `${CREW_REQUEST} #build #crew`);
  await page.getByRole('button', { name: 'Agent TV' }).click();
  const tv = tvOf(page);
  await expect(tv).toBeVisible();

  await expect(tv.locator('.tv-pk.out')).not.toHaveCount(0, { timeout: 15_000 });
  await expect(tv.locator('.tv-bub.tv-chat')).toHaveText(/^(Over to .+|Looks good to me)\.$/, {
    timeout: 15_000,
  });
  await expect(tv.locator('.tv-pk.out')).toHaveCount(0, { timeout: 5_000 });

  const ask = tv.getByRole('button', { name: /Needs you: keep these changes\?/ });
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await shot(page, 'waiting');
  await scrollThread(page, 'top');
  await ask.click();
  await expect(card(page, /Keep these changes\?/)).toBeInViewport();
});

test('the header controls explain themselves on keyboard focus', async ({ page }) => {
  test.setTimeout(60_000);
  await editWaiting(page);
  const tv = tvOf(page);
  const tooltip = page.getByRole('tooltip');
  await tv.getByRole('button', { name: 'Watch mode' }).focus();
  await page.keyboard.press('Shift+Tab');
  const mute = tv.getByRole('button', { name: 'Mute speech bubbles' });
  await expect(mute).toBeFocused();
  await expect(tooltip).toHaveText('Mute speech bubbles');
  await expect(mute).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!);
  await page.keyboard.press('Enter');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(tooltip).toHaveText('Show speech bubbles');
  await page.keyboard.press('Shift+Tab');
  await expect(tooltip).toHaveText('Small / Medium / Large TV');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(tooltip).toHaveText('Watch mode');
  await page.keyboard.press('Tab');
  await expect(tv.getByRole('button', { name: 'Close Agent TV' })).toBeFocused();
  await expect(tooltip).toHaveText('Close Agent TV (Esc)');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
});

test('muted chatter stays quiet, and the choice is remembered', async ({ page }) => {
  test.setTimeout(60_000);
  await editWaiting(page);
  const mute = tvOf(page).getByRole('button', { name: 'Mute speech bubbles' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await allowEdit(page);
  await expect(tvOf(page).locator('.tv-pk.out')).not.toHaveCount(0, { timeout: 15_000 });
  await expect(tvOf(page).locator('.tv-bub.tv-chat')).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('spark-outpost.agent-tv'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ muted: true });
});

test('with reduced motion there are no packets or bounces, only still faces and text', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await editWaiting(page);
  const tv = tvOf(page);
  await expect(tv).toHaveClass(/\bstill\b/);
  const bob = await blob(page, 'jev')
    .locator('.tv-b')
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(bob).toBe('none');

  await allowEdit(page);
  await expect(tv.locator('.tv-bub.tv-chat')).toHaveText(/^(Over to .+|Looks good to me)\.$/, {
    timeout: 15_000,
  });
  await expect(tv.locator('.tv-pk')).toHaveCount(0);
  await blob(page, 'builder').click();
  await expect(details(page)).toBeVisible();
  const animations = await blob(page, 'builder')
    .locator('.tv-sq')
    .evaluate((element) => element.getAnimations().length);
  expect(animations).toBe(0);
});

test('sizes and watch mode grow the stage, and the size is remembered', async ({ page }) => {
  test.setTimeout(60_000);
  await editWaiting(page);
  const tv = tvOf(page);
  const stageWidth = () =>
    tv.locator('.tv-stage').evaluate((element) => (element as HTMLElement).offsetWidth);
  expect(await stageWidth()).toBe(300);
  await tv.getByRole('radio', { name: 'L', exact: true }).click();
  await expect.poll(stageWidth).toBe(460);
  await shot(page, 'large');

  await tv.getByRole('button', { name: 'Watch mode' }).click();
  await expect(tv).toHaveClass(/\bwatch\b/);
  await expect.poll(stageWidth).toBeGreaterThan(900);
  const jevSize = await blob(page, 'jev')
    .locator('svg')
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(jevSize).toBeGreaterThan(100);
  await shot(page, 'watch');
  await page.keyboard.press('Escape');
  await expect(tv).not.toHaveClass(/\bwatch\b/);
  await expect(tv).toBeVisible();
  await expect.poll(stageWidth).toBe(460);

  const saved = await page.evaluate(() => localStorage.getItem('spark-outpost.agent-tv'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ size: 'l' });
});

test('dragging moves the TV and the position survives a reload', async ({ page }) => {
  test.setTimeout(60_000);
  await editWaiting(page);
  const header = tvOf(page).locator('.tv-h');
  const start = (await header.boundingBox())!;
  await page.mouse.move(start.x + 40, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x - 300, start.y - 200, { steps: 6 });
  await page.mouse.up();
  const moved = (await tvOf(page).boundingBox())!;
  const saved = await page.evaluate(() => localStorage.getItem('spark-outpost.agent-tv'));
  const { position } = JSON.parse(saved ?? '{}') as { position: { x: number; y: number } };
  expect(Math.round(moved.x)).toBe(Math.round(position.x));

  await page.reload();
  await page.getByRole('button', { name: 'Agent TV' }).click();
  await settled(page);
  const again = (await tvOf(page).boundingBox())!;
  expect(Math.round(again.x)).toBe(Math.round(moved.x));
  expect(Math.round(again.y)).toBe(Math.round(moved.y));
});

test('recording of a full run with handoffs', async ({ browser }) => {
  test.skip(!SHOTS, 'Set TV_SHOTS to a folder to capture screenshots and a recording.');
  test.setTimeout(180_000);
  const size = { width: 1400, height: 900 };
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: SHOTS, size },
  });
  const page = await context.newPage();
  await crewChat(page, repo, 'Ask before edits');
  await page.getByRole('button', { name: 'Agent TV' }).click();
  await tvOf(page).getByRole('radio', { name: 'M', exact: true }).click();
  await send(page, `${CREW_REQUEST} #build #crew`);
  await expect(tvOf(page).locator('.tv-pk.out')).not.toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, 'tv-handoff.png') });
  await blob(page, 'jev').click();
  await shot(page, 'jev-bubble');
  await page.keyboard.press('Escape');
  for (let step = 1; step <= 1; step += 1) {
    const edit = card(page, /Change a file\?/).filter({
      has: page.getByRole('button', { name: 'Deny' }),
    });
    await expect(edit).toBeVisible({ timeout: 30_000 });
    if (step === 1) await shot(page, 'waiting');
    await page.waitForTimeout(1200);
    await edit.getByRole('button', { name: 'Allow', exact: true }).click();
  }
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await shot(page, 'review');
  await tvOf(page).getByRole('button', { name: 'Watch mode' }).click();
  await shot(page, 'watch');
  await page.keyboard.press('Escape');
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await shot(page, 'done');
  const video = page.video();
  await context.close();
  await video?.saveAs(path.join(SHOTS, 'tv-run.webm'));
  await video?.delete();
});
