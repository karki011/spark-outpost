import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBrowserView, pushView } from './browser-view-support.ts';
import { resetTestDatabase } from './database.ts';
import { calls } from './desktop-browser.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

async function openWithTabs(page: Page) {
  await openBrowserView(page);
  await pushView(page, [
    {
      title: 'Deploying your app',
      url: 'https://docs.example.com/deploying',
      active: true,
      place: 'external',
    },
  ]);
  await pushView(
    page,
    [{ title: 'Pull request 42', url: 'https://git.example.com/pr/42', place: 'external' }],
    [],
    'work',
  );
}

const dock = (page: Page) => page.getByRole('complementary', { name: 'Ask Spark' });
const field = (page: Page) => dock(page).getByRole('textbox', { name: 'Ask Spark' });

test('Ask Spark reads only the tabs the question mentions, once, when it is sent', async ({
  page,
}) => {
  await openWithTabs(page);
  await page.getByRole('button', { name: 'Ask Spark', exact: true }).click();
  await expect(dock(page).getByRole('list', { name: 'Tabs you mentioned' })).toContainText(
    'Deploying your app',
  );
  await expect(field(page)).toBeFocused();

  await page.keyboard.type('Do these match @pull');
  const options = dock(page).getByRole('listbox', { name: 'Open tabs' }).getByRole('option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText('Work');
  await page.keyboard.press('Enter');
  await expect(field(page)).toHaveValue('Do these match @Pull request 42 ');
  await expect(dock(page).getByRole('list', { name: 'Tabs you mentioned' })).toContainText(
    'Pull request 42',
  );
  expect(await calls(page, 'view-page-text')).toEqual([]);

  const queued = page.waitForRequest(
    (request) => request.url().endsWith('/queue') && request.method() === 'POST',
  );
  await page.keyboard.press('Enter');
  const sent = (await queued).postDataJSON() as {
    content: string;
    origin: string;
    attachmentIds: string[];
  };
  expect(sent.content).toBe('Do these match @Pull request 42');
  expect(sent.origin).toBe('pages');
  expect(sent.attachmentIds).toHaveLength(2);
  expect(await calls(page, 'view-page-text')).toEqual([
    { profile: 'personal', tabId: 'v1' },
    { profile: 'work', tabId: 'v1' },
  ]);
  const second = await page.evaluate(
    (id) => fetch(`/api/attachments/${id}/content`).then((response) => response.text()),
    sent.attachmentIds[1]!,
  );
  expect(second).toContain('@-mentioned this Work tab');
  expect(second).toContain('Untrusted page data');
  expect(second).toContain('<page_evidence>');

  await expect(dock(page).getByText('Read 2 tabs you mentioned')).toBeVisible();
  await expect(dock(page).getByText('Page text read.')).toBeVisible();
  await expect(field(page)).toHaveValue('');
});

test('a removed tab is not read, and Esc closes the list before the dock', async ({ page }) => {
  await openWithTabs(page);
  await page.getByRole('button', { name: 'Ask Spark', exact: true }).click();
  await dock(page).getByRole('button', { name: 'Remove Deploying your app' }).click();
  await expect(field(page)).toBeFocused();
  await page.keyboard.type('@');
  await expect(dock(page).getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dock(page).getByRole('listbox')).toHaveCount(0);
  await expect(dock(page)).toBeVisible();

  await page.keyboard.press('Backspace');
  const queued = page.waitForRequest(
    (request) => request.url().endsWith('/queue') && request.method() === 'POST',
  );
  await page.keyboard.type('What is running?');
  await page.keyboard.press('Enter');
  const sent = (await queued).postDataJSON() as Record<string, unknown>;
  expect(sent.origin).toBeUndefined();
  expect(sent.attachmentIds).toBeUndefined();
  expect(await calls(page, 'view-page-text')).toEqual([]);

  await field(page).focus();
  await page.keyboard.press('Escape');
  await expect(dock(page)).toHaveCount(0);
});

test('⌥⌘A from the page opens Ask Spark, and the dock passes an accessibility check', async ({
  page,
}) => {
  await openWithTabs(page);
  await page.evaluate(() =>
    (window as unknown as { browserViewShortcut: (e: unknown) => void }).browserViewShortcut({
      profile: 'personal',
      shortcut: 'ask_spark',
    }),
  );
  await expect(dock(page)).toBeVisible();
  await page.keyboard.type('@');
  await expect(dock(page).getByRole('listbox')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.atd').analyze();
  expect(results.violations).toEqual([]);
});
