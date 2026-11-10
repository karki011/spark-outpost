import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { connectServiceNow, connectTickets, openTickets, resetTicketFakes } from './ticket-seed.ts';

test.describe.configure({ timeout: 90_000 });

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const section = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const detailOf = (page: Page, key: string) =>
  page.getByRole('complementary', { name: `${key} details` });

async function openDetail(page: Page, key: string) {
  await openTickets(page);
  await row(page, key)
    .getByRole('button', { name: new RegExp(key) })
    .first()
    .click();
  const detail = detailOf(page, key);
  await expect(detail).toBeVisible({ timeout: 15_000 });
  return detail;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
});

test('a comment posts with the button and with the keyboard and then shows in the ticket', async ({
  page,
}) => {
  await connectTickets(page);
  const detail = await openDetail(page, 'API-84');
  const box = detail.getByRole('textbox', { name: 'Comment on API-84' });
  const post = detail.getByRole('button', { name: 'Comment', exact: true });
  await expect(post).toBeDisabled();

  const toggle = detail.getByRole('button', { name: /^Comments/ });
  await expect(toggle).toHaveCount(0);

  await box.fill('Posted with the button');
  await post.click();
  await expect(toggle).toHaveText('Comments1');
  await expect(box).toHaveValue('');

  await box.fill('Posted with the keyboard');
  await box.press('ControlOrMeta+Enter');
  await expect(toggle).toHaveText('Comments2');
  await expect(box).toHaveValue('');

  await toggle.click();
  await expect(detail.locator('.tk-cmts li')).toHaveCount(2);
  await expect(detail.locator('.tk-cmts li').first()).toContainText('Posted with the button');
  await expect(detail.locator('.tk-cmts li').last()).toContainText('Posted with the keyboard');
});

test('a failing comment keeps the text and says why', async ({ page }) => {
  await connectTickets(page);
  const detail = await openDetail(page, 'API-84');
  await page.route('**/api/tickets/jira/API-84/comments', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Jira is not answering.' }),
    }),
  );
  const box = detail.getByRole('textbox', { name: 'Comment on API-84' });
  await box.fill('This one will fail');
  await detail.getByRole('button', { name: 'Comment', exact: true }).click();

  await expect(detail.getByRole('alert')).toContainText("Couldn't post the comment.");
  await expect(box).toHaveValue('This one will fail');
  await expect(detail.getByRole('button', { name: 'Comment', exact: true })).toBeEnabled();
  await box.fill('This one will fail, edited');
  await expect(detail.getByRole('alert')).toHaveCount(0);
});

test('Move to lists the other statuses and moves the ticket to another section', async ({
  page,
}) => {
  await connectTickets(page);
  const detail = await openDetail(page, 'ENG-1210');
  await expect(section(page, 'Up next')).toContainText('ENG-1210');

  await detail.getByRole('button', { name: 'Move ENG-1210 in Linear' }).click();
  const menu = page.getByRole('menu', { name: 'Move ENG-1210 in Linear' });
  await expect(menu.getByRole('menuitemradio')).toHaveText(['In progress', 'In review', 'Done']);
  await menu.getByRole('menuitemradio', { name: 'In progress' }).click();

  await expect(section(page, 'Started')).toContainText('ENG-1210', { timeout: 15_000 });
  await expect(section(page, 'Up next')).not.toContainText('ENG-1210');
  await detail.getByRole('button', { name: 'Move ENG-1210 in Linear' }).click();
  await expect(
    page
      .getByRole('menu', { name: 'Move ENG-1210 in Linear' })
      .getByRole('menuitemradio', { name: 'To do' }),
  ).toBeVisible();
});

test('a move that is skipped shows the reason and leaves the ticket where it was', async ({
  page,
}) => {
  await connectTickets(page);
  const detail = await openDetail(page, 'API-77');
  await detail.getByRole('button', { name: 'Move API-77 in Jira' }).click();
  await page
    .getByRole('menu', { name: 'Move API-77 in Jira' })
    .getByRole('menuitemradio', { name: 'To do' })
    .click();

  await expect(detail.getByRole('alert')).toContainText(
    'Left at In review; it is further along than To do.',
  );
  await expect(section(page, 'In review / PR open')).toContainText('API-77');
});

test('a ServiceNow record has neither the comment box nor Move to', async ({ page }) => {
  await connectServiceNow(page);
  const detail = await openDetail(page, 'INC0010023');
  await expect(detail.getByRole('region', { name: 'Add a comment' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: /^Move INC0010023/ })).toHaveCount(0);
});

test('the inbox says when a source has more tickets than Spark lists', async ({ page }) => {
  await connectTickets(page);
  await page.route('**/api/tickets/inbox', async (route) => {
    const response = await route.fetch();
    const inbox = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...inbox, truncated: ['jira'] } });
  });
  await openTickets(page);
  await expect(row(page, 'API-84')).toBeVisible({ timeout: 15_000 });
  const notice = main(page).getByRole('status').filter({ hasText: 'has more tickets than' });
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText('Jira has more tickets than Spark lists.');
  await expect(notice).toContainText('Showing the 500 most recently updated.');
});

test('no notice shows when nothing was cut off', async ({ page }) => {
  await connectTickets(page);
  await openTickets(page);
  await expect(row(page, 'API-84')).toBeVisible({ timeout: 15_000 });
  await expect(main(page).getByText('has more tickets than Spark lists')).toHaveCount(0);
});

test('Refresh asks the server for a fresh sync while other refetches do not', async ({ page }) => {
  await connectTickets(page);
  const asked: (string | undefined)[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/tickets/inbox') {
      asked.push(request.headers()['cache-control']);
    }
  });
  await openTickets(page);
  await expect(row(page, 'API-84')).toBeVisible({ timeout: 15_000 });
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((header) => header === undefined)).toBe(true);

  await main(page).getByRole('button', { name: 'Refresh tickets' }).click();
  await expect.poll(() => asked.at(-1)).toBe('no-cache');
});
