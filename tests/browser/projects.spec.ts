import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ADD_FOLDER, keepPlainFolder } from './add-folder-kit.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

let base = '';
let appRoot = '';
let libRoot = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-project-')));
  appRoot = path.join(base, 'app');
  libRoot = path.join(base, 'lib');
  mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  mkdirSync(libRoot);
  writeFileSync(path.join(appRoot, 'README.md'), '# Fixture project\n');
  writeFileSync(path.join(appRoot, 'src', 'notes.txt'), 'Remember the milk\n');
  writeFileSync(path.join(appRoot, 'src', 'plan.md'), 'Ship it\n');
  writeFileSync(path.join(libRoot, 'README.md'), '# Library\n');
  writeFileSync(path.join(libRoot, 'lib.txt'), 'Shared helpers\n');
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  return input;
}

async function linkFromApi(page: Page, root: string) {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
}

const repoMenu = (page: Page) => page.getByRole('dialog', { name: 'Project folders' });
const linkedRepos = (page: Page) => repoMenu(page).getByRole('list', { name: 'Linked repos' });

async function openRepoMenu(page: Page) {
  await page.locator('.ctx-repo').click();
  await expect(repoMenu(page)).toBeVisible();
}

async function addRecent(page: Page, name: string) {
  await openRepoMenu(page);
  await repoMenu(page)
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
  await expect(linkedRepos(page).getByText(name, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
}

async function linkBoth(page: Page) {
  await linkFromApi(page, appRoot);
  await linkFromApi(page, libRoot);
  const input = await newChat(page);
  await addRecent(page, 'app');
  await addRecent(page, 'lib');
  await expect(page.getByRole('button', { name: 'Project folders: app, lib' })).toBeVisible();
  return input;
}

test('picks a folder from the context bar and shows it in the bar and header', async ({ page }) => {
  await newChat(page);
  await expect(page.getByText('no project folder yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose project' })).toBeVisible();

  await openRepoMenu(page);
  const projectButton = (await page.getByRole('button', { name: 'Choose project' }).boundingBox())!;
  await expect
    .poll(async () => {
      const menu = (await repoMenu(page).boundingBox())!;
      return menu.y + menu.height;
    })
    .toBeLessThanOrEqual(projectButton.y);
  await repoMenu(page).getByRole('button', { name: ADD_FOLDER }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a project folder' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('navigation', { name: 'Folder path' }).getByRole('button').first().click();
  await expect(dialog.getByRole('button', { name: 'Parent folder' })).toBeDisabled();
  for (const segment of appRoot.split('/').filter(Boolean)) {
    await dialog
      .getByRole('list', { name: 'Folders' })
      .getByRole('button', { name: segment, exact: true })
      .click();
    await expect(dialog.locator('.fdlg-path')).toHaveText(new RegExp(`/${segment}$`));
  }
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  await expect(dialog).toBeHidden();
  await keepPlainFolder(page, 'app');

  const bar = page.getByRole('button', { name: 'Project folders: app' });
  await expect(bar).toBeVisible();
  await bar.hover();
  await expect(page.getByRole('tooltip')).toHaveText(appRoot);
  await page.mouse.move(0, 0);
  await expect(page.locator('.head .crumb')).toHaveText('app /');
  await expect(page.getByText("can read this folder's files but won't change them")).toBeVisible();
  await expect(page.locator('.ctx-branch')).toHaveCount(0);
});

test('links two repos, reorders them, removes one, and goes chat-only', async ({ page }) => {
  await linkBoth(page);
  await expect(page.locator('.ctxbar')).toContainText('app +1');
  await expect(page.locator('.head .crumb')).toHaveText('app +1 /');
  await expect(page.locator('.composer .chips .chip')).toHaveCount(0);

  await openRepoMenu(page);
  const rows = linkedRepos(page).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Primary');
  await repoMenu(page).getByRole('button', { name: 'Make lib primary' }).click();
  await expect(rows.first()).toContainText('lib');
  await expect(page.locator('.ctxbar')).toContainText('lib +1');

  await repoMenu(page).getByRole('button', { name: 'Remove app' }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Project folders: lib' })).toBeVisible();

  await repoMenu(page).getByRole('button', { name: 'No project folder' }).click();
  await expect(page.getByRole('button', { name: 'Choose project' })).toBeVisible();
  await expect(page.locator('.head .crumb')).toHaveCount(0);
});

test('a new chat starts with no project', async ({ page }) => {
  await linkBoth(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByRole('button', { name: 'Choose project' })).toBeVisible();
});

test('Add from repo searches every linked repo and sends the picked files', async ({ page }) => {
  await linkFromApi(page, appRoot);
  const input = await newChat(page);

  await page.getByRole('button', { name: 'Add files and context' }).click();
  await page.getByRole('menuitem', { name: /Add from repo/ }).click();
  await expect(repoMenu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await linkFromApi(page, libRoot);
  await addRecent(page, 'app');
  await page.getByRole('button', { name: 'Add files and context' }).click();
  await page.getByRole('menuitem', { name: 'Add a repo…' }).click();
  await expect(repoMenu(page)).toBeVisible();
  await repoMenu(page).getByRole('button', { name: /^lib/ }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Add files and context' }).click();
  await page.getByRole('menuitem', { name: 'Add from repo' }).click();
  const search = page.getByRole('combobox', { name: 'Search project files' });
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('placeholder', 'Search linked repos');
  await search.fill('readme');
  const options = page.getByRole('listbox', { name: 'Project files' }).getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText('app');
  await expect(options.nth(1)).toContainText('lib');
  await search.press('Enter');
  await options.nth(1).click();
  await expect(options.nth(0)).toHaveAttribute('data-added', 'true');
  await expect(options.nth(1)).toHaveAttribute('data-added', 'true');

  await search.fill('lib.txt');
  await expect(options).toHaveCount(1);
  await search.press('Enter');
  await search.press('Escape');
  await expect(search).toBeHidden();

  const chips = page.getByRole('group', { name: 'Attachments' });
  await expect(chips.locator('.att-chip')).toHaveCount(3);
  await expect(page.getByRole('progressbar')).toHaveCount(0);

  await input.fill('What do these say?');
  await input.press('Enter');
  await expect(
    page.locator('.md', {
      hasText: 'Attachments: README.md, README.md, lib.txt. Repos: app, lib.',
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Project folders: app, lib' })).toBeVisible();
  await expect(page.locator('.composer .att-chip')).toHaveCount(0);
});

test('typing @ opens the file picker at the caret and adds the chosen file', async ({ page }) => {
  await linkFromApi(page, appRoot);
  const input = await newChat(page);
  await addRecent(page, 'app');

  await input.focus();
  await input.pressSequentially('Summarize @pla');
  const options = page.getByRole('listbox', { name: 'Project files' }).getByRole('option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText('app/src');
  await expect(input).toHaveAttribute('aria-activedescendant', /.+/);
  await input.press('Enter');

  await expect(page.getByRole('listbox', { name: 'Project files' })).toBeHidden();
  await expect(input).toHaveValue('Summarize ');
  await expect(page.getByRole('group', { name: 'Attachments' })).toContainText('plan.md');

  await input.pressSequentially('@zzz');
  await expect(page.getByText('No matching files.')).toBeVisible();
  await input.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Project files' })).toBeHidden();
  await expect(input).toHaveValue('Summarize @zzz');
});

test('shows a server refusal on the file chip', async ({ page }) => {
  await linkFromApi(page, appRoot);
  await newChat(page);
  await addRecent(page, 'app');
  await page.route('**/api/projects/*/attachments', (route) =>
    route.fulfill({ status: 400, json: { error: 'That file is outside the project folder.' } }),
  );

  await page.getByRole('button', { name: 'Add files and context' }).click();
  await page.getByRole('menuitem', { name: 'Add from repo' }).click();
  await page.getByRole('combobox', { name: 'Search project files' }).fill('readme');
  await page.getByRole('option', { name: /README\.md/ }).click();

  const chips = page.getByRole('group', { name: 'Attachments' });
  await expect(chips).toContainText('That file is outside the project folder.');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
});
