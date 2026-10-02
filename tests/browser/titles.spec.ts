import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const FAKE_TITLE = 'Tidy the fake reply';

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const row = (page: Page, title: string) =>
  sidebar(page).getByRole('listitem').filter({ hasText: title });
const rowTitles = (page: Page) => sidebar(page).locator('.row .tt');

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(page.locator('.md', { hasText: `You wrote: "${text}"` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.msg.ai .mood').last()).toHaveText('done');
}

async function newChat(page: Page, text: string) {
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await send(page, text);
}

async function openMenu(page: Page, title: string) {
  await row(page, title).hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for ${title}` })
    .click();
  return page.getByRole('menu', { name: `Options for ${title}` });
}

test('titles a chat from the agent after its first turn and shows the turn category', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, jev: true });
  await openChats(page);
  await newChat(page, '#title please tidy this');

  await expect(row(page, FAKE_TITLE)).toBeVisible();
  await expect(row(page, FAKE_TITLE).getByRole('button').first()).toHaveAttribute(
    'title',
    new RegExp(`^${FAKE_TITLE} · Renamed by Spark · Bug fix`),
  );
  await expect(page.getByRole('heading', { level: 1, name: FAKE_TITLE })).toHaveAttribute(
    'title',
    'Renamed by Spark',
  );
  await expect(page.locator('.msg.ai .ai-head .cat-chip')).toHaveText('Bug fix');
  await expect(page.locator('.msg.ai').last()).not.toContainText('Title:');
});

test('a rename stops auto titles, and the menu can turn them back on', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, jev: true });
  await openChats(page);
  await newChat(page, 'hello there');
  await expect(rowTitles(page)).toHaveText(['Bug fix · hello there']);

  await (
    await openMenu(page, 'Bug fix · hello there')
  )
    .getByRole('menuitem', { name: 'Rename' })
    .click();
  const name = sidebar(page).getByRole('textbox', { name: 'Chat name' });
  await name.fill('My own name');
  await name.press('Enter');
  await expect(rowTitles(page)).toHaveText(['My own name']);

  await send(page, '#title rename me please');
  await expect(rowTitles(page)).toHaveText(['My own name']);

  const menu = await openMenu(page, 'My own name');
  await menu.getByRole('menuitem', { name: 'Resume auto titles' }).click();
  await send(page, '#title now rename it');
  await expect(rowTitles(page)).toHaveText([FAKE_TITLE]);
  await expect(
    (await openMenu(page, FAKE_TITLE)).getByRole('menuitem', {
      name: 'Stop auto-renaming this chat',
    }),
  ).toBeVisible();
});

test('filters the sidebar by category with is:', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, jev: true });
  await openChats(page);
  await newChat(page, '#title #debug the divider jumps');
  await newChat(page, 'fix the header typo');
  await expect(rowTitles(page)).toHaveCount(2);

  const search = page.getByRole('searchbox', { name: 'Search chats' });
  await search.fill('is:research');
  await expect(rowTitles(page)).toHaveText([FAKE_TITLE]);
  await search.fill('is:bug-fix');
  await expect(rowTitles(page)).toHaveText(['Bug fix · header typo']);
  await search.fill('is:bugfix header');
  await expect(rowTitles(page)).toHaveText(['Bug fix · header typo']);
  await search.fill('is:docs');
  await expect(sidebar(page)).toContainText('No active chats match “is:docs”.');
  await search.press('Escape');
  await expect(rowTitles(page)).toHaveCount(2);
});
