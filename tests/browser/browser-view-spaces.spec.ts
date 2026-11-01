import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openBrowserView, pushView, viewCommands } from './browser-view-support.ts';
import { calls } from './desktop-browser.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const LAYOUT = {
  spaces: [
    { id: 's1', name: 'Main', icon: 'home', color: 'accent' },
    { id: 's2', name: 'Reading', icon: 'book', color: 'muted' },
  ],
  currentSpaceId: 's1',
  folders: [{ id: 'f1', spaceId: 's1', name: 'Refs', collapsed: false }],
  places: [
    { tabId: 'v1', spaceId: 's1', folderId: null, pinnedUrl: 'https://docs.example.com/' },
    { tabId: 'v2', spaceId: 's1', folderId: 'f1', pinnedUrl: 'https://two.example.com/' },
    { tabId: 'v3', spaceId: 's2', folderId: null, pinnedUrl: null },
    { tabId: 'v4', spaceId: 's1', folderId: null, pinnedUrl: null },
  ],
  archived: [{ id: 'a1', url: 'https://old.example.com/', title: 'Old page', archivedAt: 1 }],
};

const TABS = [
  { title: 'Wandered', url: 'https://elsewhere.example.com/', pinned: true, active: true },
  { title: 'In folder', url: 'https://two.example.com/', pinned: true },
  { title: 'Other Space tab', url: 'https://three.example.com/' },
  { title: 'Today tab', url: 'https://four.example.com/' },
];

async function open(page: Parameters<typeof openBrowserView>[0]) {
  const side = await openBrowserView(page);
  await pushView(page, TABS, [], 'personal', { layout: LAYOUT });
  return side;
}

const lastCommand = async (page: Parameters<typeof viewCommands>[0]) =>
  (await viewCommands(page)).at(-1)?.command;

test('Spaces switch by control, arrow and ⌃N, showing only their own tabs', async ({ page }) => {
  const side = await open(page);
  const spaces = side.getByRole('radiogroup', { name: 'Space' });
  await expect(spaces.getByRole('radio', { name: 'Main' })).toBeChecked();
  await expect(side.getByRole('button', { name: 'Today tab', exact: true })).toBeVisible();
  await expect(side.getByRole('button', { name: 'Other Space tab', exact: true })).toHaveCount(0);

  await spaces.getByRole('radio', { name: 'Reading' }).click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'space_switch', id: 's2' });

  await spaces.getByRole('radio', { name: 'Main' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'space_switch', id: 's2' });

  await pushView(page, TABS, [], 'personal', { layout: { ...LAYOUT, currentSpaceId: 's2' } });
  await expect(side.getByRole('button', { name: 'Other Space tab', exact: true })).toBeVisible();
  await expect(side.getByRole('button', { name: 'Today tab', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Type a web address on the left')).toBeVisible();

  await spaces.getByRole('radio', { name: 'Reading' }).focus();
  await page.keyboard.press('Control+Digit1');
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'space_switch', id: 's1' });
});

test('a new Space is made by keyboard, and says it is not a boundary', async ({ page }) => {
  const side = await open(page);
  await side.getByRole('button', { name: 'New Space' }).click();
  const form = side.getByRole('form', { name: 'New Space' });
  await expect(form.getByRole('textbox', { name: 'Space name' })).toBeFocused();
  await expect(form.getByText('they all share this profile’s sign-ins')).toBeVisible();
  await page.keyboard.type('Trips');
  await form.getByRole('radio', { name: 'Cloud' }).check();
  await form.getByRole('radio', { name: 'Muted' }).check();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => lastCommand(page))
    .toEqual({ command: 'space_create', name: 'Trips', icon: 'cloud', color: 'muted' });
  await expect(form).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'New Space' })).toBeFocused();

  await side.getByRole('button', { name: 'Edit Space Main' }).click();
  await page.keyboard.press('Escape');
  await expect(side.getByRole('form', { name: 'Edit Main' })).toHaveCount(0);
});

test('a pinned tab goes to a folder by menu or drag and comes back to its address', async ({
  page,
}) => {
  const side = await open(page);
  const home = side.getByRole('button', { name: 'Back to pinned address: Wandered' });
  await home.click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'pinned_home', tabId: 'v1' });
  await expect(
    side.getByRole('button', { name: /^Back to pinned address: In folder/ }),
  ).toHaveCount(0);

  await side.getByRole('button', { name: 'More for Wandered' }).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'More for Wandered' });
  await menu.getByRole('menuitem', { name: 'Move to folder Refs' }).click();
  await expect
    .poll(() => lastCommand(page))
    .toEqual({ command: 'tab_to_folder', tabId: 'v1', folderId: 'f1' });

  const row = side.getByRole('button', { name: 'Wandered', exact: true }).locator('xpath=..');
  await row.dragTo(side.locator('.bv-folder-head'));
  await expect
    .poll(() => lastCommand(page))
    .toEqual({ command: 'tab_to_folder', tabId: 'v1', folderId: 'f1' });

  const folder = side.getByRole('button', { name: /Refs/ }).first();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await folder.click();
  await expect
    .poll(() => lastCommand(page))
    .toEqual({ command: 'folder_collapse', id: 'f1', collapsed: true });
});

test('Archived reopens from the list and the command bar', async ({ page }) => {
  const side = await open(page);
  const archived = side.getByRole('button', { name: /^Archived/ });
  await expect(archived).toHaveAttribute('aria-expanded', 'false');
  await archived.click();
  await side.getByRole('button', { name: 'Reopen Old page' }).click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'archived_open', id: 'a1' });

  await page.keyboard.press('Meta+t');
  await page.getByRole('combobox', { name: 'Open a new tab' }).fill('old page');
  await page.getByRole('option', { name: /Old page/ }).click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'archived_open', id: 'a1' });

  const results = await new AxeBuilder({ page }).include('.bv-side').analyze();
  expect(results.violations).toEqual([]);
});

test('Settings changes the archive time and turns it off', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Browser pane' }).click();
  const name = 'Archive tabs not shown for';
  const setting = page.getByRole('dialog', { name: 'Browser pane' }).getByRole('group', { name });
  const picker = setting.getByRole('button', { name });
  await expect(picker).toHaveText('12 hours');
  await picker.click();
  await page.getByRole('menuitemradio', { name: '1 day' }).click();
  await expect(picker).toHaveText('1 day');
  await picker.click();
  await page.getByRole('menuitemradio', { name: 'Never' }).click();
  await expect(picker).toHaveText('Never');
  expect(await calls(page, 'view-archive')).toEqual([
    { on: true, afterMinutes: 1440 },
    { on: false, afterMinutes: 1440 },
  ]);
});
