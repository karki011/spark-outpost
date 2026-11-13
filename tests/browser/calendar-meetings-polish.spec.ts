import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(
  process.env.SPARK_FAKE_CALENDAR !== '1' || process.env.SPARK_FAKE_MEETINGS !== '1',
  'needs SPARK_FAKE_CALENDAR=1 and SPARK_FAKE_MEETINGS=1',
);
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;
const SHOTS = process.env.SPARK_MEETING_SHOTS;
const SCHEMES = ['light', 'dark'] as const;
const today = (page: Page) => page.getByRole('main', { name: 'Today' });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor, day: true }));
  await matchApiClock(page);
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await useSystemTheme(page);
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const colorScheme of SCHEMES) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function openToday(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
}

async function meeting(page: Page, id: string) {
  const response = await page.request.get(`/api/meetings/${id}`);
  return ((await response.json()) as { meeting: { title: string; notesState: string } }).meeting;
}

async function recordingId(page: Page): Promise<string | null> {
  const status = await (await page.request.get('/api/meetings/status')).json();
  return (status as { recordingId: string | null }).recordingId;
}

test('no meetings shows one splash, and a new meeting opens on its live transcript', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openToday(page);
  const main = today(page);
  await main.getByRole('tab', { name: 'Transcripts' }).click();
  await expect(main.getByRole('heading', { name: 'Scout’s all ears' })).toBeVisible();
  await expect(main.getByText('Audio never leaves this Mac and is never saved.')).toBeVisible();
  await expect(main.getByRole('searchbox')).toHaveCount(0);
  await expect(main.getByText('Pick a meeting to see its notes and transcript.')).toHaveCount(0);
  const small = await main
    .locator('.mt-splash *')
    .evaluateAll(
      (nodes) =>
        nodes.filter(
          (node) => node.textContent?.trim() && parseFloat(getComputedStyle(node).fontSize) < 12,
        ).length,
    );
  expect(small).toBe(0);
  await shoot(page, 'empty');

  await main.getByRole('button', { name: 'New meeting' }).click();
  const sections = main.getByRole('tablist', { name: 'Meeting sections' });
  await expect(sections.getByRole('tab', { name: /^Transcript/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(main.getByRole('list', { name: 'Transcript' })).toContainText('churn');
  const search = main.getByRole('searchbox', { name: 'Search meetings' });
  await expect(search).toHaveAttribute('placeholder', 'Search');

  const side = main.getByRole('region', { name: 'Meeting history' });
  const divider = main.getByRole('separator', { name: 'Resize meeting list' });
  const before = (await side.boundingBox())!.width;
  await divider.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(before + 48);
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 40);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 30, handle.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(before + 18);
  await divider.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(before);

  const id = (await recordingId(page))!;
  expect((await meeting(page, id)).title).toBe('Untitled meeting');
  await main.getByRole('button', { name: 'Stop' }).first().click();
  await expect(sections.getByRole('tab', { name: 'Notes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect
    .poll(async () => (await meeting(page, id)).notesState, { timeout: 30_000 })
    .toBe('ready');
  await expect
    .poll(async () => (await meeting(page, id)).title, { timeout: 30_000 })
    .not.toBe('Untitled meeting');
  const title = (await meeting(page, id)).title;
  await expect(main.getByRole('textbox', { name: 'Meeting title' })).toHaveValue(title);
  await expect(main.getByRole('list', { name: 'Meetings' })).toContainText(title);
});

test('notes being written show a loading state, and Delete asks in a dialog', async ({ page }) => {
  await openToday(page);
  const main = today(page);
  await main.getByRole('tab', { name: 'Transcripts' }).click();
  await main.getByRole('button', { name: 'New meeting' }).click();
  await expect(main.getByRole('list', { name: 'Transcript' })).toContainText('churn');
  const id = (await recordingId(page))!;
  await page.request.patch(`/api/meetings/${id}`, { data: { title: 'Pricing review' } });

  await page.route(`**/api/meetings/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as { meeting: Record<string, unknown>; notes: unknown };
    if (body.meeting.state === 'recording') return route.fulfill({ response });
    return route.fulfill({
      response,
      json: { ...body, notes: null, meeting: { ...body.meeting, notesState: 'writing' } },
    });
  });
  await page.route('**/api/meetings?*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { items: { meeting: Record<string, unknown> }[] };
    const items = body.items.map((item) =>
      item.meeting.state === 'recording'
        ? item
        : { ...item, meeting: { ...item.meeting, notesState: 'writing' } },
    );
    return route.fulfill({ response, json: { ...body, items } });
  });
  await main.getByRole('button', { name: 'Stop' }).first().click();
  await expect(main.getByRole('status').filter({ hasText: 'Writing notes…' })).toBeVisible();
  await expect(main.locator('.mt-writing .skel-bar').first()).toBeVisible();
  await expect(main.getByRole('list', { name: 'Meetings' })).toContainText('Writing notes…');
  const moving = await main
    .locator('.mt-writing .skel-bar')
    .first()
    .evaluate((bar) => getComputedStyle(bar).animationName);
  expect(moving).toBe('none');
  await shoot(page, 'writing');
  await page.unroute(`**/api/meetings/${id}`);
  await page.unroute('**/api/meetings?*');

  const open = main.getByRole('button', { name: 'Delete…' });
  await open.click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete “Pricing review”?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Delete meeting' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await shoot(page, 'delete');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  expect((await page.request.get(`/api/meetings/${id}`)).status()).toBe(200);

  await open.click();
  await dialog.getByRole('button', { name: 'Delete meeting' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Scout’s all ears' })).toBeVisible();
  expect((await page.request.get(`/api/meetings/${id}`)).status()).toBe(404);
});

test('Take notes when I join a meeting is off, and once on a Join also records', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { opened });
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
  });
  const opened = () => page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  await openToday(page);
  const main = today(page);
  await main.getByRole('radio', { name: 'Day' }).click();
  await main.getByRole('button', { name: /^Live review, / }).click();
  const join = main
    .getByRole('region', { name: 'Live review' })
    .getByRole('button', { name: 'Join Google Meet Live review' });
  await join.click();
  expect(await opened()).toEqual(['https://meet.google.com/abc-defg-hij']);
  await expect(main.getByRole('region', { name: 'Recording' })).toHaveCount(0);
  expect(await recordingId(page)).toBeNull();

  await page.goto('/#/settings/notifications');
  const toggle = page.getByRole('switch', { name: 'Take notes when I join a meeting' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await openToday(page);
  await today(page).getByRole('radio', { name: 'Day' }).click();
  await today(page)
    .getByRole('button', { name: /^Live review, / })
    .click();
  await today(page)
    .getByRole('region', { name: 'Live review' })
    .getByRole('button', { name: 'Join Google Meet Live review' })
    .click();
  expect(await opened()).toEqual(['https://meet.google.com/abc-defg-hij']);
  await expect(today(page).getByRole('region', { name: 'Recording' })).toContainText('Live review');
  await expect(today(page).getByRole('tab', { name: 'Transcripts' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    today(page)
      .getByRole('tablist', { name: 'Meeting sections' })
      .getByRole('tab', { name: /^Transcript/ }),
  ).toHaveAttribute('aria-selected', 'true');
  const id = (await recordingId(page))!;
  expect((await meeting(page, id)).title).toBe('Live review');
  await today(page).getByRole('button', { name: 'Stop' }).first().click();
});

test('questions about a meeting go to its own chat through the chat composer', async ({ page }) => {
  test.setTimeout(90_000);
  await openToday(page);
  const main = today(page);
  await main.getByRole('tab', { name: 'Transcripts' }).click();
  await main.getByRole('button', { name: 'New meeting' }).click();
  await expect(main.getByRole('list', { name: 'Transcript' })).toContainText('churn');
  const ask = main.getByRole('region', { name: 'Ask about this meeting' });
  await expect(ask.getByRole('button', { name: 'Suggest a reply' })).toBeVisible();
  await expect(ask.getByRole('button', { name: /^Model/ })).toBeVisible();
  await expect(ask.locator('.ctx-bar, .ctx')).toHaveCount(0);
  await ask.getByRole('button', { name: 'Add files and context' }).click();
  await expect(page.getByRole('menuitem', { name: 'Upload a file' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /repo/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && /\/api\/conversations\/[^/]+\/messages$/.test(request.url()),
  );
  await ask.getByRole('button', { name: 'Catch me up' }).click();
  const body = (await sent).postDataJSON() as { content: string; attachmentIds: string[] };
  expect(body.content).toContain('Catch me up');
  expect(body.attachmentIds).toHaveLength(1);
  const thread = ask.getByRole('list', { name: 'Questions about this meeting' });
  await expect(thread).toContainText('Catch me up on the last few minutes');
  await expect(thread.locator('.mt-ask-answer')).toHaveCount(1, { timeout: 45_000 });

  const box = ask.getByRole('textbox', { name: 'Message' });
  await box.fill('What did we decide about pricing?');
  await box.press('Enter');
  await expect(thread.locator('.mt-ask-answer')).toHaveCount(2, { timeout: 45_000 });
  await expect(thread.locator('.mt-ask-question')).toHaveCount(2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await shoot(page, 'ask');
  await main.getByRole('button', { name: 'Stop' }).first().click();
  await expect(ask.getByRole('button', { name: 'Action items' })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Suggest a reply' })).toHaveCount(0);
  await expect(main.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  await expect(thread.locator('.mt-ask-answer')).toHaveCount(2);

  await ask.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByRole('main', { name: 'Today' })).toHaveCount(0);
  await expect(page.getByText('What did we decide about pricing?').first()).toBeVisible();
});
