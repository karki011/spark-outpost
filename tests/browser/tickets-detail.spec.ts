import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedFlowChats } from './ticket-flow-seed.ts';
import {
  connectTickets,
  hoverOnceSettled,
  openTickets,
  resetTicketFakes,
  STUB_URL,
} from './ticket-seed.ts';
import { FAKE_GH_STATE } from './stub-config.ts';

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const detailOf = (page: Page, key: string) =>
  page.getByRole('complementary', { name: `${key} details` });
const field = (page: Page, key: string, label: string) =>
  detailOf(page, key).locator('.tk-props dt', { hasText: label }).locator('+ dd');
const paneWidth = async (page: Page, key: string) =>
  Math.round((await detailOf(page, key).boundingBox())!.width);

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ request }) => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
  await request.post(`${STUB_URL}/github-test/reset`);
});

test.afterEach(() => rmSync(FAKE_GH_STATE, { force: true }));

async function openInbox(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await connectTickets(page);
  await page.request.get('/api/tickets/inbox');
  await seedFlowChats([
    {
      key: 'API-77',
      source: 'jira',
      status: 'succeeded',
      pull: { number: 341, checks: 'passing' },
    },
  ]);
  await openTickets(page);
  await expect(row(page, 'API-77')).toBeVisible({ timeout: 15_000 });
}

test('a ticket shows its status badge, reporter, created date and pull requests', async ({
  page,
}) => {
  await openInbox(page);
  await expect(row(page, 'API-77').locator('.fchip.in_review')).toHaveText('Code Review');
  await expect(row(page, 'API-81').locator('.fchip.blocked')).toHaveText('Blocked');
  await expect(
    row(page, 'API-77').getByRole('img', { name: 'Assigned to Alex Example' }),
  ).toBeVisible();
  const chip = row(page, 'API-77').getByRole('button', { name: /^Open PR #341 for API-77/ });
  await expect(chip).toBeVisible();
  await chip.focus();
  await expect(chip).toBeFocused();
  await expect(page.getByRole('complementary')).toHaveCount(0);

  await row(page, 'API-77').locator('.ir-main').click();
  const detail = detailOf(page, 'API-77');
  await expect(field(page, 'API-77', 'Status').locator('.fchip.in_review')).toHaveText(
    'Code Review',
  );
  await expect(field(page, 'API-77', 'Reporter')).toHaveText('Priya Nair');
  await expect(field(page, 'API-77', 'Created')).toHaveText('6 days ago');
  await expect(field(page, 'API-77', 'Created').locator('time')).toHaveAttribute(
    'title',
    /\b20\d\d\b/,
  );
  const pulls = detail.getByRole('region', { name: 'Development' });
  const pull = pulls.getByRole('link', { name: /#341/ });
  await expect(pull).toHaveAttribute('href', 'https://github.com/acme/widgets/pull/341');
  await expect(pull).toHaveAttribute('target', '_blank');
  await expect(pull).toContainText('Checks passing');
  await expect(
    detail.getByRole('region', { name: 'Linked work' }).getByRole('button'),
  ).toContainText('Chat');

  await row(page, 'ENG-1215').locator('.ir-main').click();
  await expect(field(page, 'ENG-1215', 'Reporter')).toHaveText('Not known');
  await expect(field(page, 'ENG-1215', 'Created')).toHaveText('5 days ago');
  await expect(
    detailOf(page, 'ENG-1215').getByRole('region', { name: 'Development' }),
  ).toContainText('No pull request is linked');

  await hoverOnceSettled(page, row(page, 'API-81').locator('.tk-key'));
  const preview = page.getByRole('tooltip', { name: /^API-81/ });
  await expect(preview).toContainText('Priya Nair · created 6 days ago');
  await expect(preview).toContainText('Alex Example');
});

test('the detail pane resizes by keyboard and drag, remembers its width and fits narrow windows', async ({
  page,
}) => {
  await openInbox(page);
  await row(page, 'API-77').locator('.ir-main').click();
  await expect(detailOf(page, 'API-77')).toBeVisible();
  expect(await paneWidth(page, 'API-77')).toBe(500);

  const handle = page.getByRole('separator', { name: 'Resize ticket details' });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '516');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => paneWidth(page, 'API-77')).toBe(564);
  await expect(page.getByRole('complementary', { name: 'API-77 details' })).toBeVisible();

  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => paneWidth(page, 'API-77')).toBe(604);
  await expect(handle).toHaveAttribute('aria-valuenow', '604');

  await page.reload();
  await row(page, 'API-77').locator('.ir-main').click({ timeout: 15_000 });
  await expect.poll(() => paneWidth(page, 'API-77')).toBe(604);

  await handle.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => paneWidth(page, 'API-77')).toBe(500);
  await page.keyboard.press('End');
  const list = (await main(page).locator('.ib-main').boundingBox())!;
  expect(list.width).toBeGreaterThanOrEqual(380);

  await page.setViewportSize({ width: 1000, height: 800 });
  const overlay = (await detailOf(page, 'API-77').boundingBox())!;
  expect(overlay.x).toBeGreaterThan(100);
  expect(overlay.x + overlay.width).toBeLessThanOrEqual(1000);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toBeHidden();
  expect(await paneWidth(page, 'API-77')).toBe(390);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a searched ticket is assigned from the detail pane, and Start work moves and assigns by default', async ({
  page,
}) => {
  await openInbox(page);
  await page.keyboard.press('/');
  await page.keyboard.type('upload');
  await expect(row(page, 'WEB-440').getByRole('img', { name: 'Unassigned' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    row(page, 'WEB-437').getByRole('img', { name: 'Assigned to Jordan Lee' }),
  ).toBeVisible();
  await expect(row(page, 'API-95').locator('.fchip.todo')).toHaveText('Ready for implementation');

  await row(page, 'WEB-440').locator('.ir-main').click();
  await expect(field(page, 'WEB-440', 'Assignee')).toHaveText('Unassigned');
  await detailOf(page, 'WEB-440').getByRole('button', { name: 'Assign to me' }).click();
  await expect(
    page.locator('.tk-toasts').getByText('Assigned WEB-440 to you in Linear.'),
  ).toBeVisible();
  await expect(field(page, 'WEB-440', 'Assignee')).toHaveText('Alex Example (you)');
  await expect(detailOf(page, 'WEB-440').getByRole('button', { name: 'Assign to me' })).toHaveCount(
    0,
  );

  await row(page, 'API-95').locator('.ir-main').click();
  const detail = detailOf(page, 'API-95');
  await expect(detail.getByRole('button', { name: 'Assign to me' })).toBeVisible();
  await expect(
    detail.getByRole('region', { name: 'Development' }).getByRole('link', { name: /#52/ }),
  ).toHaveAttribute('href', 'https://github.com/acme/api/pull/52');
  await detail.getByRole('button', { name: 'Start work' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start work on API-95' });
  await expect(dialog.locator('.fchip.todo')).toHaveText('Ready for implementation');
  await expect(
    dialog.getByRole('switch', { name: 'Move API-95 to In progress in Jira' }),
  ).toBeChecked();
  await expect(dialog.getByRole('switch', { name: 'Assign API-95 to me in Jira' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Start with a plan' }).click();
  await expect(page.locator('.chat-title')).toContainText('API-95', { timeout: 15_000 });

  const inbox = await (await page.request.get('/api/tickets/inbox')).json();
  const started = inbox.tickets.find((ticket: { key: string }) => ticket.key === 'API-95');
  expect(started).toMatchObject({
    status: 'in_progress',
    statusName: 'In Progress',
    assignedTo: { name: 'Alex Example' },
    reporter: { name: 'Priya Nair' },
  });
});
