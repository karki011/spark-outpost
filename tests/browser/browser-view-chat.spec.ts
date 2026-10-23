import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBrowserView, pushView } from './browser-view-support.ts';
import { resetTestDatabase } from './database.ts';
import { calls } from './desktop-browser.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const DOCS = 'https://docs.example.com/deploying';

async function openWithPage(page: Page) {
  await openBrowserView(page);
  await pushView(page, [
    { title: 'Deploying your app', url: DOCS, active: true, place: 'external' },
  ]);
}

const dock = (page: Page) => page.getByRole('complementary', { name: 'New chat' });

test('New chat starts a chat about the page at Automatic, with its text as an untrusted attachment', async ({
  page,
}) => {
  await openWithPage(page);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const panel = dock(page);
  await expect(panel.getByText('Deploying your app')).toBeVisible();
  await expect(panel.getByText('page text')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Autonomy' })).toHaveText('Automatic');
  await expect(panel.getByRole('textbox', { name: 'Message' })).toBeFocused();
  expect(await calls(page, 'view-page-text')).toEqual([]);

  const settings = page.waitForRequest(
    (request) => request.url().endsWith('/settings') && request.method() === 'PATCH',
  );
  const message = page.waitForRequest(
    (request) => request.url().endsWith('/messages') && request.method() === 'POST',
  );
  const upload = page.waitForRequest(
    (request) => request.url().endsWith('/api/attachments') && request.method() === 'POST',
  );
  await panel.getByRole('textbox', { name: 'Message' }).fill('Summarize the deploy steps');
  await page.keyboard.press('Enter');

  await upload;
  expect((await settings).postDataJSON()).toEqual({ level: 'hands-off' });
  const sent = (await message).postDataJSON() as { content: string; attachmentIds: string[] };
  expect(sent.content).toBe('Summarize the deploy steps');
  expect(sent.attachmentIds).toHaveLength(1);
  const uploaded = await page.evaluate(
    (id) => fetch(`/api/attachments/${id}/content`).then((response) => response.text()),
    sent.attachmentIds[0]!,
  );
  expect(uploaded).toContain('Untrusted page data');
  expect(uploaded).toContain('acme deploy --prod');
  expect(uploaded).toContain('<page_evidence>');
  expect(await calls(page, 'view-page-text')).toEqual([{ profile: 'personal', tabId: 'v1' }]);
  await expect(panel.getByRole('status')).toContainText('The chat started');
});

test('a selection and a link from the page menu open the dock with what was picked', async ({
  page,
}) => {
  await openWithPage(page);
  const intent = (value: unknown) =>
    page.evaluate(
      (sent) =>
        (window as unknown as { browserViewIntent: (i: unknown) => void }).browserViewIntent(sent),
      value,
    );
  await intent({
    profile: 'personal',
    tabId: 'v1',
    kind: 'new_chat',
    selection: 'Promote the preview',
    link: null,
  });
  await expect(dock(page).getByText('Selected text')).toBeVisible();
  await expect(dock(page).getByText('19 chars')).toBeVisible();
  await expect(dock(page).getByText('page text')).toBeVisible();
  await dock(page).getByRole('button', { name: 'Remove page text' }).click();
  await expect(dock(page).getByText('page text')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dock(page)).toHaveCount(0);

  await intent({
    profile: 'personal',
    tabId: 'v1',
    kind: 'new_chat',
    selection: null,
    link: 'https://docs.example.com/rate-limits',
  });
  await expect(dock(page).getByRole('textbox', { name: 'Message' })).toHaveValue(
    'Open https://docs.example.com/rate-limits and ',
  );
  await expect(dock(page).getByText('page text')).toHaveCount(0);
});

test('⌘⇧O from the page opens the dock, and the dock passes an accessibility check', async ({
  page,
}) => {
  await openWithPage(page);
  await page.evaluate(() =>
    (window as unknown as { browserViewShortcut: (e: unknown) => void }).browserViewShortcut({
      profile: 'personal',
      shortcut: 'new_chat',
    }),
  );
  await expect(dock(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.pcd').analyze();
  expect(results.violations).toEqual([]);
});
