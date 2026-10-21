import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { ISLAND_BLOB } from '../../packages/contracts/src/island-size.ts';
import { HIT_MARGIN } from '../../apps/web/src/island/island-regions.ts';
import {
  island,
  latestRegions,
  NOTCH,
  openNotchIsland,
  restSize,
  settled,
} from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const SIZES = ['small', 'medium', 'large'] as const;
const BORDER = 2;
const PEEK_MIN = 72;
const BADGE_ROOM = 16;

const working = (title: string) => ({ title, run: { status: 'running' }, minutesAgo: 1 });
const asking = (title: string) => ({
  title,
  run: { status: 'awaiting_approval' },
  approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
});

interface Footprint {
  view: string | null;
  island: number;
  scoutLeft: number;
  scoutRight: number;
  scoutRegion: number;
  rest: number | null;
}

async function footprint(page: Page, notch: boolean): Promise<Footprint> {
  await page.waitForTimeout(1200);
  await settled(page);
  if (!notch) await expect.poll(() => restSize(page)).not.toBeNull();
  const drawn = await island(page).evaluate((root) => {
    const scout = root.querySelector('.isl-scout-wrap')!.getBoundingClientRect();
    return {
      view: root.getAttribute('data-view'),
      island: root.getBoundingClientRect().width,
      scoutLeft: scout.left,
      scoutRight: scout.right,
    };
  });
  const regions = await latestRegions(page);
  expect(regions?.boxes ?? []).toEqual([]);
  const scoutRegion = regions?.scout?.box.width ?? 0;
  return { ...drawn, scoutRegion, rest: (await restSize(page))?.width ?? null };
}

function compactWidth(notch: boolean, blob: number): number {
  return (notch ? Math.max(NOTCH.width, PEEK_MIN) : blob) + BORDER;
}

function expectCompact(seen: Footprint, notch: boolean, blob: number) {
  const limit = compactWidth(notch, blob);
  expect(seen.view).toBe('peek');
  expect(seen.island).toBeLessThanOrEqual(limit);
  expect(seen.scoutRight - seen.scoutLeft).toBeLessThanOrEqual(blob + BORDER);
  expect(seen.scoutRegion).toBeGreaterThan(0);
  expect(seen.scoutRegion).toBeLessThanOrEqual(blob + BORDER);
  if (notch) return;
  expect(seen.rest).not.toBeNull();
  expect(seen.rest!).toBeLessThanOrEqual(blob + BADGE_ROOM + 2 * HIT_MARGIN);
}

for (const size of SIZES) {
  for (const notch of [true, false]) {
    const where = notch ? 'under a notch' : 'on a flat display';
    test(`at ${size} size ${where} the resting island stays the compact Scout with 1 or 3 working chats and 0 or 2 requests`, async ({
      page,
    }) => {
      const blob = ISLAND_BLOB[size];
      await resetTestDatabase({ onboarded: true });
      await seedChats([working('Fix billing totals')]);
      await openNotchIsland(page, { size, autoExpand: false, notch });
      expectCompact(await footprint(page, notch), notch, blob);
      await expect(island(page).locator('.isl-pbadge')).toHaveCount(0);

      await seedChats([working('Tidy the README'), working('Port the CLI')]);
      const three = await footprint(page, notch);
      expectCompact(three, notch, blob);
      await expect(island(page).locator('.isl-view')).toHaveCount(0);

      await seedChats([asking('Deploy the site'), asking('Ship the docs')]);
      await expect(island(page).locator('.isl-pbadge')).toHaveText('2');
      expectCompact(await footprint(page, notch), notch, blob);
      await expect(island(page).locator('.isl-view')).toHaveCount(0);
    });
  }
}
