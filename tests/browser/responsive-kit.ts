import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { APP_ORIGIN } from './stub-config.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

export interface Size {
  width: number;
  height: number;
}

export const PHONE: Size = { width: 390, height: 844 };
export const PHONE_WIDE: Size = { width: 844, height: 390 };
export const TABLET: Size = { width: 820, height: 1180 };
export const TABLET_WIDE: Size = { width: 1180, height: 820 };
export const DESKTOP: Size = { width: 1440, height: 900 };
export const TOUCH_SIZES = [PHONE, PHONE_WIDE, TABLET, TABLET_WIDE];

export const sizeName = (size: Size) => `${size.width}x${size.height}`;
export const isPhone = (size: Size) => size.width <= 640 || size.height <= 500;

export type ViewName = 'home' | 'chats' | 'analytics' | 'tickets' | 'map' | 'docs' | 'phone';

export async function openTouch(
  browser: Browser,
  size: Size,
  view: ViewName,
  prepare: (page: Page) => Promise<unknown> = async () => undefined,
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_ORIGIN,
    viewport: size,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.addInitScript((saved) => {
    localStorage.setItem('spark-outpost.theme', 'system');
    localStorage.setItem('spark-outpost.view', saved);
  }, view);
  await prepare(page);
  await page.goto('/');
  await mainNav(page).waitFor();
  return page;
}

export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

export const navButton = (page: Page, name: string) =>
  mainNav(page).getByRole('button', { name: new RegExp(`^${name}`) });

export async function openSettings(page: Page, phone: boolean): Promise<Locator> {
  if (phone) await navButton(page, 'More').click();
  await navButton(page, 'Settings').click();
  const dialog = page.getByRole('dialog', { name: 'Spark' });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function expectInsideViewport(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) return 'no box';
      const fits =
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width + 0.5 &&
        box.y + box.height <= viewport.height + 0.5;
      return fits ? 'inside' : JSON.stringify(box);
    })
    .toBe('inside');
}

export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

export function widerThanItsBox(scroller: Locator): Promise<string[]> {
  return scroller.evaluate((node) => {
    const edge = node.getBoundingClientRect().right;
    const pans = !['hidden', 'clip'].includes(getComputedStyle(node).overflowX);
    if (!pans || node.scrollWidth <= node.clientWidth) return [];
    return [...node.querySelectorAll<HTMLElement>('*')]
      .filter((child) => child.getBoundingClientRect().right > edge + 1)
      .map((child) => `${child.tagName}.${child.className}`)
      .slice(0, 5);
  });
}

export async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const size = page.viewportSize();
  if (!size) return;
  const folder = path.join(SHOTS, sizeName(size));
  mkdirSync(folder, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(folder, `${name}.png`), animations: 'disabled' });
}

export const SHARED_TAP_TARGETS = [
  '.icon-btn',
  '.info-tip',
  '.btn.sm',
  '.seg button',
  '.rmenu',
  '.rgrip',
  '.pchip',
  '.send-caret',
  '.qs-btn',
  '.tk .qa',
  '.tk .kref',
].join(', ');

export function smallTapTargets(page: Page, selectors = SHARED_TAP_TARGETS): Promise<string[]> {
  return page.evaluate((query) => {
    const small: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(query)) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (getComputedStyle(element).visibility === 'hidden') continue;
      const hit = getComputedStyle(element, '::before');
      const grown = hit.content !== 'none' && hit.position === 'absolute';
      const width = Math.max(rect.width, grown ? parseFloat(hit.width) : 0);
      const height = Math.max(rect.height, grown ? parseFloat(hit.height) : 0);
      if (width < 44 || height < 44) {
        small.push(`${element.className} ${Math.round(width)}x${Math.round(height)}`);
      }
    }
    return small;
  }, selectors);
}

export function smallTextInputs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fields = document.querySelectorAll<HTMLElement>(
      'input:not([type="checkbox"], [type="radio"], [type="range"], [type="file"]), textarea, select, [contenteditable="true"]',
    );
    const small: string[] = [];
    for (const field of fields) {
      if (field.getBoundingClientRect().width === 0) continue;
      const size = parseFloat(getComputedStyle(field).fontSize);
      if (size < 16) small.push(`${field.tagName} ${field.className} ${size}px`);
    }
    return small;
  });
}
