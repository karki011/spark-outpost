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
  await expect(dock(page).getByText('Selected text')).toBeVisible();

  const message = page.waitForRequest(
    (request) => request.url().endsWith('/messages') && request.method() === 'POST',
  );
  await dock(page).getByRole('textbox', { name: 'Message' }).fill('Explain this');
  await page.keyboard.press('Enter');
  const sent = (await message).postDataJSON() as { attachmentIds: string[] };
  expect(sent.attachmentIds).toHaveLength(1);
  const uploaded = await page.evaluate(
    (id) => fetch(`/api/attachments/${id}/content`).then((response) => response.text()),
    sent.attachmentIds[0]!,
  );
  expect(uploaded).toContain('The user selected this text in the Browser view.');
  expect(uploaded).toContain('Promote the preview');
  expect(await calls(page, 'view-page-text')).toEqual([]);
  await expect(dock(page).getByRole('status')).toContainText('The chat started');

  await dock(page).getByRole('button', { name: 'Close' }).click();
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

test('a pasted key holds the chat until the user deals with it', async ({ page }) => {
  await openWithPage(page);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  let posted = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/messages') && request.method() === 'POST') posted += 1;
  });
  const input = dock(page).getByRole('textbox', { name: 'Message' });
  await input.fill('Use my key sk-ant-api03-FAKEfake0123456789abcdEFGH here');
  await page.keyboard.press('Enter');
  const warning = dock(page).getByRole('alert').filter({ hasText: 'This looks like' });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button', { name: 'Remove it' })).toBeFocused();
  expect(posted).toBe(0);
  expect(await calls(page, 'view-page-text')).toEqual([]);

  await warning.getByRole('button', { name: 'Remove it' }).click();
  await expect(input).toHaveValue('Use my key [removed] here');
  await expect(input).toBeFocused();
  await expect(dock(page)).toBeVisible();
});

function pushPick(page: Page, chatId: 'personal' | 'work', image: string | null) {
  return page.evaluate(
    (pick) =>
      (window as unknown as { browserViewPick: (p: unknown) => void }).browserViewPick(pick),
    {
      chatId,
      kind: 'element',
      url: DOCS,
      title: 'Deploying your app',
      box: { x: 1, y: 2, width: 30, height: 40 },
      elements: [
        {
          role: 'button',
          name: 'Deploy',
          html: '<button>Deploy</button>',
          styles: {},
          box: { x: 1, y: 2, width: 30, height: 40 },
        },
      ],
      image,
    },
  );
}

test('Select starts in the page bar and each pick lands in the new-chat dock', async ({ page }) => {
  await openWithPage(page);
  await page.getByRole('button', { name: 'Select an element for a new chat' }).click();
  await expect
    .poll(async () => (await calls(page, 'view-command')).at(-1))
    .toMatchObject({ profile: 'personal', command: { command: 'pick', mode: 'element' } });
  await pushPick(page, 'personal', null);
  const attached = dock(page).getByRole('list', { name: 'Attached' });
  await expect(attached.getByText('Selected: Deploy button')).toBeVisible();
  await expect(attached.getByText('note', { exact: true })).toBeVisible();
  await pushPick(page, 'personal', null);
  await expect(attached.getByRole('listitem')).toHaveCount(2);
  await attached.getByRole('button', { name: 'Remove Selected: Deploy button' }).first().click();
  await expect(attached.getByRole('listitem')).toHaveCount(1);
  await expect(dock(page).getByRole('textbox', { name: 'Message' })).toBeFocused();
});

test('a pick from the other profile does not land in this dock', async ({ page }) => {
  await openWithPage(page);
  await pushPick(page, 'work', null);
  await expect(dock(page)).toHaveCount(0);
});
