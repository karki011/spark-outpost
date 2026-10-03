import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';
import { openChats } from './navigation.ts';

test.setTimeout(60_000);

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const row = (page: Page, title: string) =>
  sidebar(page).getByRole('listitem').filter({ hasText: title });
const toast = (page: Page, text: string) =>
  sidebar(page).getByRole('status').filter({ hasText: text });

async function deleteChat(page: Page, title: string) {
  await row(page, title).hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for ${title}` })
    .click();
  const menu = page.getByRole('menu', { name: `Options for ${title}` });
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await menu.getByRole('menuitem', { name: 'Confirm delete' }).click();
}

test('a chat with a stuck run is stopped and deleted, and stays gone after reload', async ({
  page,
}) => {
  await seedChats([
    { title: 'Stuck chat', run: { status: 'running' } },
    { title: 'Waiting chat', run: { status: 'awaiting_approval' } },
    { title: 'Other chat' },
  ]);
  await openChats(page);
  await expect(row(page, 'Stuck chat')).toBeVisible();

  await deleteChat(page, 'Stuck chat');
  await expect(row(page, 'Stuck chat')).toHaveCount(0);
  await expect(toast(page, 'Stopping and deleting Stuck chat')).toBeVisible();
  await expect(toast(page, 'Stopping and deleting Stuck chat')).toBeHidden({ timeout: 8_000 });

  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/conversations')).text()).includes('Stuck chat'),
      {
        timeout: 25_000,
      },
    )
    .toBe(false);
  await page.reload();
  await expect(row(page, 'Stuck chat')).toHaveCount(0);
  await expect(row(page, 'Waiting chat')).toBeVisible();
  await expect(row(page, 'Other chat')).toBeVisible();
});

test('a delete that fails says so and offers Retry instead of quietly reverting', async ({
  page,
}) => {
  await seedChats([{ title: 'Stubborn chat' }, { title: 'Other chat' }]);
  let failing = true;
  await page.route('**/api/conversations/*', async (route) => {
    if (route.request().method() !== 'DELETE' || !failing) return route.continue();
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'The database is busy.' }),
    });
  });
  await openChats(page);

  await deleteChat(page, 'Stubborn chat');
  await expect(row(page, 'Stubborn chat')).toHaveCount(0);
  const failure = toast(page, 'Could not delete Stubborn chat');
  await expect(failure).toBeVisible({ timeout: 10_000 });
  await expect(failure).toContainText('The database is busy.');
  await expect(row(page, 'Stubborn chat')).toBeVisible();

  failing = false;
  await failure.getByRole('button', { name: 'Retry' }).click();
  await expect(row(page, 'Stubborn chat')).toHaveCount(0);
  await page.reload();
  await expect(row(page, 'Stubborn chat')).toHaveCount(0);
  await expect(row(page, 'Other chat')).toBeVisible();
});
