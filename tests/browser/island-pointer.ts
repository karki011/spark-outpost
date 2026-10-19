import { expect, type Page } from '@playwright/test';

const BODY = { top: 17 / 64, bottom: 58 / 64 };
const STILL_MS = 120;

export interface ScoutBody {
  x: number;
  y: number;
  top: number;
  bottom: number;
}

export function scoutBody(page: Page): Promise<ScoutBody> {
  return page.locator('.isl-scout-wrap').evaluate((element, body) => {
    const box = element.getBoundingClientRect();
    const edge = (element as HTMLElement).dataset.edge;
    const clip = edge === undefined ? 0 : Number(edge);
    const top = Math.max(box.top + box.height * body.top, clip);
    const bottom = box.top + box.height * body.bottom;
    return { x: box.left + box.width / 2, y: (top + bottom) / 2, top, bottom };
  }, BODY);
}

export async function stillScout(page: Page): Promise<ScoutBody> {
  let last = await scoutBody(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(STILL_MS);
      const next = await scoutBody(page);
      const moved = Math.abs(next.x - last.x) + Math.abs(next.y - last.y);
      last = next;
      return moved;
    })
    .toBeLessThan(0.5);
  return last;
}

export async function pointAtScout(page: Page): Promise<ScoutBody> {
  const body = await stillScout(page);
  await page.mouse.move(body.x, 400);
  await page.mouse.move(body.x, body.y, { steps: 4 });
  return body;
}
