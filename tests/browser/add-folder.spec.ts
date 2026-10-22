import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  ADD_FOLDER,
  browseTo,
  CLONE_REPO,
  keepPlainFolder,
  plainFolderNotice,
} from './add-folder-kit.ts';
import { resetTestDatabase } from './database.ts';
import { CLONE_TEST_ROOT } from './stub-config.ts';
import { openChats } from './navigation.ts';
import { NAME, newOutpost } from './outposts-kit.ts';
import { seedChats } from './sidebar-seed.ts';

let base = '';

test.beforeEach(async ({ page }) => {
  mkdirSync(CLONE_TEST_ROOT, { recursive: true });
  base = realpathSync(mkdtempSync(path.join(CLONE_TEST_ROOT, 'add-folder-')));
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function gitRepo(name: string): string {
  const folder = path.join(base, name);
  mkdirSync(folder);
  execFileSync('git', ['init', '-q', folder]);
  return folder;
}

const SWITCHES = {
  settings: true,
  connections: true,
  agentMode: true,
  highRiskCards: true,
  signIns: true,
  reset: true,
  devices: false,
  passkeys: true,
  terminal: false,
  terminalApprove: false,
  notifications: false,
  artifacts: false,
};

async function actAsPhone(page: Page, projects: boolean) {
  await page.route('**/api/remote/session', (route) =>
    route.fulfill({
      json: {
        remote: true,
        device: { id: '6f1c2b8e-4d1a-4f8e-9a51-1b2c3d4e5f60', name: 'Test phone' },
        address: 'mac.tail1234.ts.net',
        switches: { ...SWITCHES, projects },
      },
    }),
  );
}

async function openHomeComposer(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  const composer = page.getByRole('main').getByRole('region', { name: 'Start a new chat' });
  await expect(composer).toBeVisible();
  return composer;
}

test('the composer menu ends with Add folder and Clone, keeps the draft and returns focus', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  const repo = gitRepo('shop-app');
  const composer = await openHomeComposer(page);
  const draft = composer.getByRole('textbox').first();
  await draft.fill('Add a CSV export');
  const chip = composer.getByRole('button', { name: 'Choose project' });
  await chip.click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  const rows = menu.locator('button.mopt');
  await expect(rows.nth(-2)).toHaveAccessibleName(ADD_FOLDER);
  await expect(rows.nth(-1)).toHaveAccessibleName(CLONE_REPO);
  await expect(rows.nth(-2)).toContainText('Browse folders on this Mac');

  await rows.nth(-2).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Choose a project folder' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(draft).toHaveValue('Add a CSV export');

  await chip.click();
  await menu.getByRole('button', { name: ADD_FOLDER }).click();
  await browseTo(dialog, repo);
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  await expect(dialog).toHaveCount(0);
  const linked = composer.getByRole('button', { name: 'Project folders: shop-app' });
  await expect(linked).toBeFocused();
  await expect(plainFolderNotice(page, 'shop-app')).toHaveCount(0);
  await expect(draft).toHaveValue('Add a CSV export');
});

test('Settings → Projects makes a new folder and, when asked, a git repository', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Projects' })
    .click();
  const add = page.getByRole('group', { name: 'Add a project' }).getByRole('button', {
    name: 'Add folder…',
  });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Choose a project folder' });
  await browseTo(dialog, base);
  await dialog.getByRole('button', { name: 'New folder' }).click();
  const name = dialog.getByRole('textbox', { name: 'New folder name' });
  await expect(name).toBeFocused();
  await name.fill('../escape');
  await name.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('Folder names can’t contain / or :.');
  await page.keyboard.press('Escape');
  await expect(name).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'New folder' })).toBeFocused();

  await page.keyboard.press('Enter');
  await name.fill('invoice-tool');
  await name.press('Enter');
  await expect(dialog.locator('.fdlg-path')).toHaveText(path.join(base, 'invoice-tool'));
  await dialog.getByRole('button', { name: 'Use this folder' }).click();

  const notice = plainFolderNotice(page, 'invoice-tool');
  await expect(notice).toContainText('isn’t a git repository');
  const toggle = notice.getByRole('switch', { name: 'Make it a git repository' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await notice.getByRole('button', { name: 'Done' }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => existsSync(path.join(base, 'invoice-tool', '.git'))).toBe(true);
  await expect(page.getByRole('list', { name: 'Linked folders' })).toContainText('invoice-tool');
  await expect(add).toBeFocused();
});

test('a new outpost chat with no projects adds a folder from its picker', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
  const folder = path.join(base, 'storefront');
  mkdirSync(folder);
  await openChats(page);
  const sheet = await newOutpost(page, NAME);
  await sheet.getByRole('radio', { name: 'New chat' }).click();
  const trigger = sheet.getByRole('button', { name: 'Project', exact: true });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Project' });
  await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await expect(menu.getByRole('menuitem', { name: ADD_FOLDER })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Choose a project folder' });
  await browseTo(dialog, folder);
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  await keepPlainFolder(page, 'storefront');
  await expect(trigger).toContainText('storefront');
  await expect(trigger).toBeFocused();
  await expect(sheet).toBeVisible();
});

test('Move to project adds a folder and moves the chat into it', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Loose chat' }]);
  const repo = gitRepo('billing');
  await openChats(page);
  const sidebar = page.getByRole('navigation', { name: 'Chats' });
  await sidebar.getByRole('listitem').filter({ hasText: 'Loose chat' }).hover();
  await sidebar.getByRole('button', { name: 'Options for Loose chat' }).click();
  const menu = page.getByRole('menu', { name: 'Options for Loose chat' });
  await menu.getByRole('menuitem', { name: 'Move to project' }).focus();
  await page.keyboard.press('ArrowRight');
  const move = page.getByRole('menu', { name: 'Move to project' });
  await move.getByRole('menuitem', { name: 'Add folder…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a project folder' });
  await browseTo(dialog, repo);
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sidebar.locator('.pblock', { hasText: 'billing' }).getByRole('listitem')).toHaveText(
    ['Loose chat'],
  );
});

test('on a paired device Add folder browses the Mac and can make a folder there', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await actAsPhone(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  const composer = await openHomeComposer(page);
  await composer.getByRole('button', { name: 'Choose project' }).click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  const add = menu.getByRole('button', { name: ADD_FOLDER });
  await expect(add).toContainText('Browse folders on your Mac');
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Choose a project folder' });
  await browseTo(dialog, base);
  await dialog.getByRole('button', { name: 'New folder' }).click();
  await dialog.getByRole('textbox', { name: 'New folder name' }).fill('from-phone');
  await dialog.getByRole('button', { name: 'Make folder' }).click();
  await expect(dialog.locator('.fdlg-path')).toHaveText(path.join(base, 'from-phone'));
  expect(existsSync(path.join(base, 'from-phone'))).toBe(true);
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  await keepPlainFolder(page, 'from-phone');
  await expect(composer.getByRole('button', { name: 'Project folders: from-phone' })).toBeVisible();
});

test('on a paired device with the switch off the rows stay, disabled, with the reason', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await actAsPhone(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  const composer = await openHomeComposer(page);
  await composer.getByRole('button', { name: 'Choose project' }).click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  for (const name of [ADD_FOLDER, CLONE_REPO]) {
    const row = menu.getByRole('button', { name });
    await expect(row).toBeDisabled();
    await expect(row).toContainText('Turned off for remote control on your Mac');
  }
});
