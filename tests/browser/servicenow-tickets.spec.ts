import { expect, test, type Page } from '@playwright/test';
import { axeInEveryTheme } from './connector-cards.ts';
import { resetTestDatabase } from './database.ts';
import {
  connectServiceNow,
  openTickets,
  resetTicketFakes,
  serviceNowWrites,
} from './ticket-seed.ts';

test.describe.configure({ timeout: 120_000 });

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const detailOf = (page: Page, key: string) =>
  page.getByRole('complementary', { name: `${key} details` });

async function openRecord(page: Page, key: string) {
  await row(page, key)
    .getByRole('button', { name: new RegExp(key) })
    .first()
    .click();
  return detailOf(page, key);
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
});

test('ServiceNow records join the inbox with their own states and words', async ({ page }) => {
  await connectServiceNow(page);
  await openTickets(page);
  await expect(row(page, 'INC0010023')).toContainText('In Progress', { timeout: 15_000 });
  await expect(row(page, 'INC0010027')).toContainText('On Hold');
  await expect(row(page, 'SCTASK0010051')).toBeVisible();
  await expect(
    row(page, 'INC0010023')
      .getByRole('button', { name: /ServiceNow INC0010023/ })
      .first(),
  ).toBeVisible();

  const detail = await openRecord(page, 'INC0010023');
  const props = detail.locator('dl.tk-props');
  await expect(props).toContainText('TypeIncident');
  await expect(props).toContainText('Assignment groupNetwork Ops');
  await expect(props).toContainText('CallerSam Ortiz');
  await expect(detail).toContainText('vpn-client.log · 24 KB');
  await detail.getByRole('button', { name: /Comments/ }).click();
  const notes = detail.locator('.tk-cmts li');
  await expect(notes).toHaveCount(3);
  await expect(notes.filter({ hasText: 'Reproduced on a test laptop.' })).toContainText('Internal');
  await expect(notes.filter({ hasText: 'It dropped again' })).toContainText('Caller sees it');
  await axeInEveryTheme(page, 'aside.tk-detail');
});

test('the composer adds a work note at once and asks before a comment the caller sees', async ({
  page,
}) => {
  await connectServiceNow(page);
  await openTickets(page);
  const detail = await openRecord(page, 'INC0010023');
  const composer = detail.getByRole('region', { name: 'Add a work note or comment' });
  const kinds = composer.getByRole('radiogroup', { name: 'Note kind' });
  await expect(kinds.getByRole('radio', { name: 'Work note · internal' })).toBeChecked();
  await composer.getByLabel('Work note').fill('Raised the idle timeout to 8 h.');
  await composer.getByRole('button', { name: 'Add work note' }).click();
  await expect(composer.getByRole('status')).toHaveText('Work note added.');

  await kinds.getByRole('radio', { name: 'Work note · internal' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(kinds.getByRole('radio', { name: 'Comment · caller sees it' })).toBeChecked();
  await composer.getByLabel('Comment the caller sees').fill('We found the cause.');
  await composer.getByRole('button', { name: 'Post comment the caller sees…' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Post a comment the caller sees?' });
  await expect(confirm).toContainText('Sam Ortiz and the watchers of INC0010023 see it');
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await axeInEveryTheme(page, '.cx-confirm');
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  expect((await serviceNowWrites()).map((write) => write.body)).toEqual([
    { work_notes: 'Raised the idle timeout to 8 h.' },
  ]);
  await composer.getByRole('button', { name: 'Post comment the caller sees…' }).click();
  await confirm.getByRole('button', { name: 'Post comment' }).click();
  await expect(composer.getByRole('status')).toHaveText('Comment posted.');
  expect((await serviceNowWrites()).map((write) => write.body)).toEqual([
    { work_notes: 'Raised the idle timeout to 8 h.' },
    { comments: 'We found the cause.' },
  ]);
});

test('changes are read only and Start work opens the start dialog', async ({ page }) => {
  await connectServiceNow(page);
  await openTickets(page);
  const change = await openRecord(page, 'CHG0030012');
  await expect(change.locator('dl.tk-props')).toContainText('TypeChange');
  await expect(change.getByRole('region', { name: 'Add a work note or comment' })).toHaveCount(0);
  await row(page, 'INC0010031').hover();
  await page.getByRole('button', { name: 'Start INC0010031' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start work on INC0010031' });
  await expect(dialog).toContainText('Move INC0010031 to In progress in ServiceNow');
});
