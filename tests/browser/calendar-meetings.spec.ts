import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(
  process.env.SPARK_FAKE_CALENDAR !== '1' || process.env.SPARK_FAKE_MEETINGS !== '1',
  'needs SPARK_FAKE_CALENDAR=1 and SPARK_FAKE_MEETINGS=1',
);
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;
const today = (page: Page) => page.getByRole('main', { name: 'Today' });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor, day: true }));
  await matchApiClock(page);
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

async function openMeetings(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  await today(page).getByRole('tab', { name: 'Transcripts' }).click();
}

async function notesState(page: Page, id: string): Promise<string> {
  const response = await page.request.get(`/api/meetings/${id}`);
  const detail = (await response.json()) as { meeting: { notesState: string } };
  return detail.meeting.notesState;
}

test('a meeting is recorded, transcribed, written up, found by search and kept across a reload', async ({
  page,
}) => {
  await openMeetings(page);
  const main = today(page);
  await main.getByRole('button', { name: 'New meeting' }).click();

  await expect(main.getByText('Recording').first()).toBeVisible();
  const list = main.getByRole('list', { name: 'Meetings' });
  await list.getByRole('button').first().click();
  await main
    .getByRole('tablist', { name: 'Meeting sections' })
    .getByRole('tab', { name: /^Transcript/ })
    .click();
  const transcript = main.getByRole('list', { name: 'Transcript' });
  await expect(transcript).toContainText('churn');
  await expect(transcript).toContainText('Others');
  await expect(transcript).toContainText('You');
  await expect(transcript).toContainText('apply it in January', { timeout: 15_000 });

  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 920, height: 560 });
  await expect
    .poll(() =>
      main.locator('.mt-transcript').evaluate((el) => el.scrollHeight > el.clientHeight + 20),
    )
    .toBe(true);
  expect(
    await main.locator('.home').evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeLessThanOrEqual(1);
  const side = await main.getByRole('region', { name: 'Meeting history' }).boundingBox();
  const open = await main.getByRole('region', { name: 'Open meeting' }).boundingBox();
  expect(open!.x).toBeGreaterThanOrEqual(side!.x + side!.width - 1);
  expect(open!.width).toBeGreaterThan(side!.width);
  await page.setViewportSize(size);

  const status = await (await page.request.get('/api/meetings/status')).json();
  const id = (status as { recordingId: string }).recordingId;
  await main.getByRole('button', { name: 'Stop' }).first().click();
  await expect(main.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await expect.poll(() => notesState(page, id), { timeout: 30_000 }).toBe('ready');
  await main.getByRole('tab', { name: 'Notes' }).click();
  await expect(main.getByRole('button', { name: 'Write again' })).toBeVisible();

  await main.getByRole('searchbox', { name: 'Search meetings' }).fill('churn');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('churn');
  await main.getByRole('searchbox', { name: 'Search meetings' }).fill('zebra');
  await expect(list.getByRole('button')).toHaveCount(0);

  await main.getByRole('tab', { name: 'Calendar' }).click();
  await expect(main.getByRole('radio', { name: 'Month' })).toBeVisible();
  await expect(main.getByRole('searchbox', { name: 'Search meetings' })).toHaveCount(0);
  await main.getByRole('tab', { name: 'Transcripts' }).click();
  await expect(main.getByRole('searchbox', { name: 'Search meetings' })).toHaveValue('zebra');
  await expect(main.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');

  await page.reload();
  await expect(today(page).getByRole('tab', { name: 'Transcripts' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(today(page).getByRole('radio', { name: 'Month' })).toHaveCount(0);
  await expect(today(page).getByRole('list', { name: 'Meetings' }).getByRole('button')).toHaveCount(
    1,
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('a calendar meeting offers Take notes and shows it is recording', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  const main = today(page);
  await main.getByRole('radio', { name: 'Day' }).click();
  await main
    .getByRole('button', { name: /^Design review/ })
    .first()
    .click();
  await main.getByRole('button', { name: 'Take notes' }).click();
  await expect(main.getByText('Recording').first()).toBeVisible();
  const status = (await (await page.request.get('/api/meetings/status')).json()) as {
    recordingId: string;
  };
  const detail = (await (await page.request.get(`/api/meetings/${status.recordingId}`)).json()) as {
    meeting: { title: string; source: string };
  };
  expect(detail.meeting).toMatchObject({ title: 'Design review', source: 'calendar' });
  await main.getByRole('button', { name: 'Stop' }).first().click();
  await expect(main.getByRole('button', { name: 'Stop' })).toHaveCount(0);
});
