import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { ago, inbox, ITEMS, pull, stubInbox, type Json } from './github-page-support.ts';

const DESCRIBED: Json[] = [
  pull('1', {
    title: 'Fix timezone in export filenames',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    createdAt: '2026-11-02T09:00:00Z',
    updatedAt: ago(2),
  }),
  pull('2', {
    title: 'Add audit log table',
    headRef: 'spark/audit-trail',
    bodyPreview: 'Adds a table that keeps the sub-chat tree for later.',
    updatedAt: ago(5),
  }),
  ...ITEMS.slice(2),
];

const LONG_BODY = [
  '## Summary',
  '',
  'Keeps the **audit** rows.',
  '',
  ...Array.from({ length: 30 }, (_, index) => `- step ${index + 1}`),
].join('\n');

async function stubDetails(page: Page) {
  await page.route('**/api/github/inbox/details?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('id');
    return route.fulfill({
      json: {
        id,
        body: id === 'acme/api#2' ? LONG_BODY : '',
        bodyCut: false,
        files: [{ path: 'src/audit/table.ts', status: 'added', additions: 40, deletions: 0 }],
        filesTotal: 3,
      },
    });
  });
}

function openOnGithubPage(page: Page) {
  return page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('GitHub page searches titles, branches and descriptions across every group', async ({
  page,
}) => {
  await stubInbox(page, inbox({ items: DESCRIBED }));
  await stubDetails(page);
  await openOnGithubPage(page);
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await expect(main.locator('.gh-main').first()).toBeVisible();

  await page.keyboard.press('/');
  const search = main.getByRole('searchbox', { name: 'Search pull requests' });
  await expect(search).toBeFocused();
  await search.fill('audit');
  await expect(main.getByRole('status').filter({ hasText: 'match' })).toHaveText(
    '1 pull request matches “audit”',
  );
  const tiles = main.getByRole('radiogroup', { name: 'Pull request groups' });
  await expect(tiles.getByRole('radio', { name: /^Review requested/ })).toHaveAccessibleName(
    /1 match$/,
  );
  await expect(tiles.getByRole('radio', { name: /^Needs fixes/ })).toHaveAccessibleName(
    /No match$/,
  );
  const results = main.getByRole('list', { name: /Review requested · 1/ });
  await expect(results.locator('.gh-main')).toHaveCount(1);
  await expect(results.locator('mark').first()).toHaveText('audit');

  await search.fill('sub-chat');
  await expect(results.locator('.gh-found')).toContainText('In description:');
  await search.fill('retry');
  await expect(main.getByRole('list', { name: /Needs fixes · 1/ })).toContainText('Retry webhooks');
  await search.fill('nothing like this');
  await expect(main.getByText('No pull requests match.')).toBeVisible();

  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(main.getByRole('list', { name: 'Review requested' })).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('.gh').analyze();
  expect(audit.violations).toEqual([]);
});

test('GitHub page shows when each pull request was opened and updated', async ({ page }) => {
  await stubInbox(page, inbox({ items: DESCRIBED }));
  await openOnGithubPage(page);
  await page.goto('/');
  const row = page
    .getByRole('main', { name: 'GitHub' })
    .locator('.gh-row')
    .filter({ hasText: 'Fix timezone' });
  await expect(row.locator('.gh-dates')).toContainText(/Opened Nov 2.*updated 2 h ago/);
  await expect(row.locator('.gh-label')).toHaveText('bug');
});

test('GitHub page opens on the pull request looked at last, or else the newest', async ({
  page,
}) => {
  const calls = await stubInbox(page, inbox({ items: DESCRIBED }), { remember: true });
  await stubDetails(page);
  await openOnGithubPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await expect(
    main.getByRole('complementary', { name: 'Fix timezone in export filenames' }),
  ).toBeVisible();
  expect(calls.seen).toEqual([]);

  await main
    .getByRole('radiogroup')
    .getByRole('radio', { name: /^Needs fixes/ })
    .click();
  await main.getByRole('button', { name: /Retry webhooks/ }).click();
  await page.reload();
  await expect(main.getByRole('complementary', { name: 'Retry webhooks' })).toBeVisible();
  await expect(
    main.getByRole('radiogroup').getByRole('radio', { name: /^Needs fixes/ }),
  ).toHaveAttribute('aria-checked', 'true');

  await main.getByRole('button', { name: 'Close details' }).click();
  await expect(main.getByRole('complementary')).toHaveCount(0);
  await page.reload();
  await expect(main.locator('.gh-main').first()).toBeVisible();
  await expect(main.getByRole('complementary')).toHaveCount(0);
});

test('GitHub page shows the description, branches and changed files', async ({ page }) => {
  await stubInbox(page, inbox({ items: DESCRIBED }));
  await stubDetails(page);
  await openOnGithubPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await main.getByRole('button', { name: /Add audit log table/ }).click();
  const pane = main.getByRole('complementary', { name: 'Add audit log table' });
  await expect(pane.locator('.gh-branches')).toHaveText('spark/audit-trail → main');
  await expect(pane.getByRole('heading', { name: 'Summary' })).toBeVisible();
  const more = pane.getByRole('button', { name: 'Show more' });
  await expect(pane.locator('.gh-body')).toHaveAttribute('data-collapsed', '');
  await more.click();
  await expect(pane.getByRole('button', { name: 'Show less' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(pane.getByText('step 30')).toBeVisible();
  await pane.getByText('Changed files · 3').click();
  await expect(pane.getByRole('list', { name: 'Changed files' })).toContainText(
    'src/audit/table.ts',
  );
  await expect(pane.getByText('2 more on GitHub.')).toBeVisible();

  await main.getByRole('button', { name: /Fix timezone/ }).click();
  await expect(main.getByRole('complementary', { name: /Fix timezone/ })).toContainText(
    'No description.',
  );
  const audit = await new AxeBuilder({ page }).include('.gh').analyze();
  expect(audit.violations).toEqual([]);
});

test('GitHub page starts a chat for a pull request outside linked projects', async ({ page }) => {
  await stubInbox(page, inbox({ items: DESCRIBED }));
  await stubDetails(page);
  await openOnGithubPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await main.getByRole('button', { name: /Add audit log table/ }).click();
  const pane = main.getByRole('complementary', { name: 'Add audit log table' });
  await expect(pane.getByText("This repository isn't a linked project")).toBeVisible();
  await pane.getByRole('button', { name: 'Start chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toContainText(
    'Pull request acme/api#2: https://github.com/acme/api/pull/2',
  );
});

test('GitHub page starts a chat on the pull request branch and removes it when that fails', async ({
  page,
}) => {
  const projectId = '7a1c2f9e-3b44-4c5d-8e6f-112233445566';
  const items = DESCRIBED.map((item) => ({ ...item, projectId }));
  await stubInbox(page, inbox({ items }));
  await stubDetails(page);
  const created: Json[] = [];
  const deleted: string[] = [];
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const sent = route.request().postDataJSON() as Json;
    created.push(sent);
    return route.continue({ postData: JSON.stringify({ ...sent, projectIds: [] }) });
  });
  await page.route('**/api/conversations/*/workspace/adopt', (route) =>
    route.fulfill({ status: 409, json: { error: 'The branch is checked out in another chat.' } }),
  );
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && /\/api\/conversations\/[^/]+$/.test(request.url())) {
      deleted.push(new URL(request.url()).pathname.split('/').at(-1)!);
    }
  });
  await openOnGithubPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await main.getByRole('button', { name: /Add audit log table/ }).click();
  const pane = main.getByRole('complementary', { name: 'Add audit log table' });
  await pane.getByRole('button', { name: 'Start chat' }).click();
  await expect(pane.getByRole('alert')).toHaveText('The branch is checked out in another chat.');
  expect(created).toEqual([
    expect.objectContaining({
      sessionType: 'chat',
      projectIds: [projectId],
      title: 'PR #2: Add audit log table',
    }),
  ]);
  await expect.poll(() => deleted).toEqual([created[0]!.id]);
  await expect(pane.getByRole('button', { name: 'Start chat' })).toBeEnabled();
});
