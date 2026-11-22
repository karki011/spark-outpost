import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { pointAtScout } from './island-pointer.ts';
import {
  island,
  openNotchIsland,
  settled,
  type NotchSetup,
  type NotchWindow,
} from './island-notch-desktop.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const MEETING_ID = '11111111-1111-4111-8111-111111111111';
const PLACES: Record<string, Partial<NotchSetup>> = {
  notch: {},
  flat: { notch: false },
};

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-recording-${name}.png`),
    clip: { x: 240, y: 0, width: 800, height: 240 },
  });
}

async function recordMeeting(page: Page, title: string) {
  await page.route('**/api/meetings/status', (route) =>
    route.fulfill({
      json: { supported: true, available: true, reason: null, recordingId: MEETING_ID },
    }),
  );
  await page.route(`**/api/meetings/${MEETING_ID}`, (route) =>
    route.fulfill({
      json: {
        meeting: {
          id: MEETING_ID,
          title,
          source: 'adhoc',
          eventKey: null,
          calendarName: null,
          startedAt: new Date(Date.now() - 29_000).toISOString(),
          endedAt: null,
          state: 'recording',
          goal: '',
          userNotes: '',
          lineCount: 0,
          notesState: 'none',
          notesNote: null,
        },
        notes: null,
        attachments: [],
      },
    }),
  );
}

for (const [place, setup] of Object.entries(PLACES)) {
  test(`${place}: resting Scout shows a recording wave, clear of the notch and inside the resting window`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await recordMeeting(page, 'Untitled meeting');
    await openNotchIsland(page, { size: 'large', autoExpand: false, ...setup });
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    const tag = island(page).locator('.isl-rec-tag');
    await expect(tag.locator('.isl-rec-wave i')).toHaveCount(18);
    await expect(island(page).locator('.isl-scout-btn')).toHaveAccessibleName(
      /recording a meeting/,
    );
    await settled(page);
    const box = (await tag.boundingBox())!;
    const top = setup.notch === false ? 0 : 32;
    expect(box.y).toBeGreaterThanOrEqual(top);
    const scout = (await island(page).locator('.isl-scout-wrap').boundingBox())!;
    expect(box.x).toBeGreaterThan(scout.x + scout.width * 0.9);
    if (setup.notch === false) {
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as NotchWindow).islandRest.at(-1)?.width ?? 0),
        )
        .toBeGreaterThanOrEqual(2 * (box.x + box.width - 640));
    }
    await shot(page, `rest-${place}`);
  });

  test(`${place}: the hover line keeps a long title, Open transcript and Stop on one row`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await recordMeeting(page, 'Quarterly pricing and packaging review with the whole team');
    await openNotchIsland(page, { size: 'large', autoExpand: false, ...setup });
    await expect(island(page).locator('.isl-rec-tag')).toBeVisible();
    await pointAtScout(page);
    const line = island(page).getByRole('region', { name: 'Recording' });
    await expect(line).toBeVisible();
    await expect(island(page).locator('.isl-rec-tag')).toHaveCount(0);
    await settled(page);
    const open = (await line.getByRole('button', { name: 'Open transcript' }).boundingBox())!;
    const stop = (await line.getByRole('button', { name: 'Stop' }).boundingBox())!;
    const title = (await line.getByRole('button', { name: /^Quarterly/ }).boundingBox())!;
    const frame = (await line.boundingBox())!;
    expect(Math.abs(open.y - stop.y)).toBeLessThan(1);
    expect(stop.x).toBeGreaterThan(open.x + open.width);
    expect(title.x + title.width).toBeLessThanOrEqual(open.x);
    expect(stop.x + stop.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(frame.height).toBeLessThanOrEqual(56);
    await shot(page, `line-${place}`);
  });
}
