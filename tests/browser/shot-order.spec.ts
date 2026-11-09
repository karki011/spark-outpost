import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { chatRepo, type ChatRepo, linkedChat, resetWithAgents, send } from './project-chat-kit.ts';
import { withDesktopBrowser } from './desktop-browser.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const FAKE_HOST = process.env.SPARK_FAKE_BROWSER === '1';
const FIRST = 'Opening the settings page.';
const SECOND = 'The header looks right.';
const THIRD = 'Both views check out.';
const SHOT = 'shot';
const REPLY = [FIRST, SHOT, SECOND, SHOT, THIRD];
const THUMB = 'Open screenshot of Fixture login';
const IMAGES = '**/api/attachments/*/content';

let repo: ChatRepo;
let gates: string;

test.describe.configure({ timeout: 180_000 });
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  test.skip(!FAKE_HOST, 'Run with SPARK_FAKE_BROWSER=1 to give the worker a fake browser host.');
  await resetWithAgents();
  repo = chatRepo();
  gates = mkdtempSync(path.join(os.tmpdir(), 'spark-shot-gates-'));
  await page.setViewportSize({ width: 1400, height: 900 });
  await withDesktopBrowser(page);
});

test.afterEach(() => {
  repo?.remove();
  if (gates) rmSync(gates, { recursive: true, force: true });
});

const gate = (name: string) => path.join(gates, name);
const open = (name: string) => writeFileSync(gate(name), '');

interface ScriptOptions {
  gated?: boolean;
  row?: boolean;
}

function script({ gated = false, row = false }: ScriptOptions = {}): string {
  const wait = (name: string) => (gated ? [{ waitFor: gate(name) }] : []);
  const shot = { tool: 'spark_browser_screenshot' };
  return JSON.stringify([
    { say: `${FIRST}\n\n` },
    { tool: 'spark_browser_open', args: { url: 'http://localhost:5199/settings' } },
    shot,
    ...wait('one'),
    { say: `${SECOND}\n\n` },
    { ...shot, args: { fullPage: true } },
    ...wait('two'),
    { say: THIRD },
    ...(row ? [shot, shot, shot] : []),
  ]);
}

async function order(scope: Locator): Promise<string[]> {
  return scope.evaluate(
    (element, lines) =>
      [...element.querySelectorAll('p, figure.shot')].flatMap((node) => {
        if (node.matches('figure')) return ['shot'];
        const line = lines.find((text) => node.textContent?.includes(text));
        return line ? [line] : [];
      }),
    [FIRST, SECOND, THIRD],
  );
}

async function shoot(page: Page, file: string) {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${file}.png`) });
}

async function placement(turn: Locator) {
  return turn.evaluate((element) => {
    const text = element.querySelector('p')!.getBoundingClientRect();
    const figure = element.querySelector('figure.shot')!.getBoundingClientRect();
    return {
      below: Math.round(figure.top - text.top),
      width: Math.round(figure.width),
      height: Math.round(figure.height),
      turn: Math.round(element.getBoundingClientRect().height),
    };
  });
}

const probed = (turn: Locator) => turn.locator('[data-probe]');

async function finishedSoloTurn(page: Page, options: ScriptOptions = {}): Promise<Locator> {
  await linkedChat(page, repo);
  await send(page, `#build #sparkscript ${script(options)}`);
  const turn = page.locator('.msg.ai').last();
  await expect(turn.getByRole('button', { name: /^Checked in browser/ })).toBeAttached({
    timeout: 60_000,
  });
  return turn;
}

test('a screenshot stays where it was taken while the reply streams, with no jump when it loads', async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(IMAGES, async (route) => {
    await held;
    await route.continue();
  });
  await linkedChat(page, repo);
  await send(page, `#build #sparkscript ${script({ gated: true })}`);
  const turn = page.locator('.msg.ai').last();
  const thumbs = turn.getByRole('button', { name: THUMB });
  await expect(thumbs).toHaveCount(1, { timeout: 60_000 });
  expect(await order(turn)).toEqual([FIRST, SHOT]);
  await expect(turn.getByText(SECOND)).toHaveCount(0);

  const image = thumbs.first().locator('img');
  await expect(image).toHaveJSProperty('naturalWidth', 0);
  const waiting = await placement(turn);
  expect(await image.boundingBox()).toMatchObject({ width: 160, height: 100 });
  await turn.evaluate((element) => {
    element.querySelector('p')!.setAttribute('data-probe', 'text');
    element.querySelector('figure.shot button')!.setAttribute('data-probe', 'shot');
  });
  release();
  await expect(image).toHaveJSProperty('naturalWidth', 1280);
  expect(await placement(turn)).toEqual(waiting);
  await expect(image).toHaveAttribute('alt', 'Screenshot of Fixture login');

  open('one');
  await expect(thumbs).toHaveCount(2, { timeout: 60_000 });
  expect(await order(turn)).toEqual([FIRST, SHOT, SECOND, SHOT]);
  expect((await placement(turn)).below).toBe(waiting.below);
  expect(await thumbs.nth(1).locator('img').boundingBox()).toMatchObject({
    width: 160,
    height: 120,
  });
  await shoot(page, 'shot-order-streaming');

  open('two');
  await expect(turn.getByRole('button', { name: /^Checked in browser/ })).toBeAttached({
    timeout: 60_000,
  });
  expect(await order(turn)).toEqual(REPLY);
  expect((await placement(turn)).below).toBe(waiting.below);
  await expect(probed(turn)).toHaveCount(2);

  await page.reload();
  await expect(thumbs).toHaveCount(2);
  expect(await order(turn)).toEqual(REPLY);
  await expect(turn.getByText(/^localhost:5199\/settings$/)).toHaveCount(2);
  await shoot(page, 'shot-order-reloaded');
});

test('a thumbnail opens and closes by mouse and keyboard, and focus comes back to it', async ({
  page,
}) => {
  const turn = await finishedSoloTurn(page);
  const thumb = turn.getByRole('button', { name: THUMB }).first();
  const zoomed = page.getByRole('dialog', { name: 'Screenshot of Fixture login' });

  await thumb.click();
  await expect(zoomed).toBeVisible();
  await expect(zoomed.getByRole('img', { name: 'Screenshot of Fixture login' })).toBeVisible();
  const dialogAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('dialog.lightbox')
    .analyze();
  expect(dialogAxe.violations).toEqual([]);
  await shoot(page, 'shot-order-zoom');
  await zoomed.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
  await expect(thumb).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(zoomed).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
  await expect(thumb).toBeFocused();
  const ring = await thumb.evaluate((element) => ({
    shown: element.matches(':focus-visible'),
    style: getComputedStyle(element).outlineStyle,
    width: Number.parseFloat(getComputedStyle(element).outlineWidth),
  }));
  expect(ring.shown).toBe(true);
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);

  await page.keyboard.press('Space');
  await expect(zoomed).toBeVisible();
  await page.mouse.click(6, 6);
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
  await expect(thumb).toBeFocused();

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.shot-list')
    .analyze();
  expect(axe.violations).toEqual([]);
});

test('at phone width the order holds, thumbnails wrap, and a tap zooms and closes', async ({
  page,
}) => {
  await finishedSoloTurn(page, { row: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const turn = page.locator('.msg.ai').last();
  const thumbs = turn.getByRole('button', { name: THUMB });
  await expect(thumbs).toHaveCount(5);
  expect(await order(turn)).toEqual([...REPLY, SHOT, SHOT, SHOT]);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
  const boxes = await Promise.all([2, 3, 4].map((index) => thumbs.nth(index).boundingBox()));
  expect(boxes.every((box) => box!.width <= 160 && box!.x >= 0 && box!.x + box!.width <= 390)).toBe(
    true,
  );
  expect(boxes[0]!.y).toBeCloseTo(boxes[1]!.y, 0);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
  const caption = turn.locator('.shot figcaption').first();
  expect(await caption.evaluate((element) => element.scrollWidth > 0)).toBe(true);
  await thumbs.last().scrollIntoViewIfNeeded();
  await shoot(page, 'shot-order-phone');

  const zoomed = page.getByRole('dialog', { name: 'Screenshot of Fixture login' });
  await thumbs.first().tap();
  await expect(zoomed).toBeVisible();
  const frame = await zoomed.boundingBox();
  expect(frame!.x).toBeGreaterThanOrEqual(0);
  expect(frame!.x + frame!.width).toBeLessThanOrEqual(390);
  expect(frame!.y + frame!.height).toBeLessThanOrEqual(844);
  const view = zoomed.locator('.lightbox-view');
  const fits = () => view.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(await fits()).toBe(true);
  expect(await view.evaluate((element) => getComputedStyle(element).touchAction)).toBe(
    'manipulation',
  );
  await shoot(page, 'shot-order-phone-zoom');
  await zoomed.getByRole('button', { name: 'Full size' }).tap();
  expect(await fits()).toBe(false);
  await view.evaluate((element) => element.scrollTo(600, 0));
  expect(await view.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const stillFramed = await zoomed.boundingBox();
  expect(stillFramed!.x + stillFramed!.width).toBeLessThanOrEqual(390);
  await zoomed.getByRole('button', { name: 'Close' }).tap();
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
  await expect(thumbs.first()).toBeFocused();

  await thumbs.first().tap();
  await expect(zoomed).toBeVisible();
  await page.touchscreen.tap(195, 8);
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
  await expect(thumbs.first()).toBeFocused();
});

test('in a row of screenshots, the arrow keys and buttons step through them and stop at the ends', async ({
  page,
}) => {
  const turn = await finishedSoloTurn(page, { row: true });
  const thumbs = turn.getByRole('button', { name: THUMB });
  await expect(thumbs).toHaveCount(5);
  const zoomed = page.locator('dialog.lightbox');
  const place = zoomed.locator('.lightbox-place');
  const name = zoomed.locator('figcaption a');
  const previous = zoomed.getByRole('button', { name: 'Previous image' });
  const next = zoomed.getByRole('button', { name: 'Next image' });

  await thumbs.nth(3).click();
  await expect(place).toHaveText('2 of 3');
  const middle = await name.getAttribute('href');
  await page.keyboard.press('ArrowRight');
  await expect(place).toHaveText('3 of 3');
  expect(await name.getAttribute('href')).not.toBe(middle);
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(place).toHaveText('3 of 3');
  await expect(zoomed.getByRole('img', { name: 'Screenshot of Fixture login' })).toBeVisible();

  await previous.click();
  await previous.click();
  await expect(place).toHaveText('1 of 3');
  await expect(previous).toHaveAttribute('aria-disabled', 'true');
  await expect(previous).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(place).toHaveText('1 of 3');
  const box = await previous.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(28);
  expect(box!.height).toBeGreaterThanOrEqual(28);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('dialog.lightbox')
    .analyze();
  expect(axe.violations).toEqual([]);
  await shoot(page, 'shot-order-steps');

  await page.keyboard.press('Escape');
  await expect(zoomed).toHaveCount(0);
  await expect(thumbs.nth(3)).toBeFocused();

  await thumbs.first().click();
  await expect(zoomed).toBeVisible();
  await expect(place).toHaveCount(0);
  await expect(next).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(zoomed).toHaveCount(0);
});
