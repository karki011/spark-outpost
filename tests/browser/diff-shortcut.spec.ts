import { expect, test } from '@playwright/test';
import { chatRepo, type ChatRepo } from './project-chat-kit.ts';
import { resetTestDatabase } from './database.ts';
import { allowEdit, askForEdit, editedChat } from './edited-chat.ts';
import { openChats } from './navigation.ts';

test.use({ trace: 'off' });

let repo: ChatRepo;

test.beforeEach(async () => {
  repo = chatRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => repo.remove());

test('the changes shortcut opens and closes the drawer and hands focus back @packaged', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await editedChat(page, repo.root);
  const chip = page.getByRole('button', { name: '1 line added, 0 removed in 1 file' });
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await expect(chip).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+D$/);
  const composer = page.getByRole('textbox', { name: 'Message' });
  const drawer = page.getByRole('dialog', { name: 'Changes · 1 file' });

  await composer.focus();
  await page.keyboard.press('ControlOrMeta+D');
  await expect(drawer).toBeVisible();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer.getByRole('tree', { name: 'Changed files' })).toBeFocused();
  await expect(drawer.getByText('No changes yet')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+D');
  await expect(drawer).toHaveCount(0);
  await expect(composer).toBeFocused();

  await page.keyboard.press('ControlOrMeta+D');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(composer).toBeFocused();

  await page.keyboard.press('ControlOrMeta+Shift+D');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+D');
  await expect(drawer).toHaveCount(0);
  await expect(composer).toBeFocused();

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Settings/ })
    .click();
  await expect(page.locator('[aria-modal="true"]')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+D');
  await page.keyboard.press('ControlOrMeta+Shift+D');
  await expect(page.locator('.dd')).toHaveCount(0);
});

test('the changes shortcut shows an empty state in a chat with no work yet', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.fill('draft');
  await page.keyboard.press('ControlOrMeta+D');
  const drawer = page.getByRole('dialog', { name: 'Changes', exact: true });
  await expect(drawer).toBeFocused();
  await expect(drawer.getByRole('status')).toContainText('No changes yet');
  await expect(drawer.getByRole('status')).toContainText(
    'Changes will show here as the agent edits files.',
  );
  await expect(drawer.getByRole('tree')).toHaveCount(0);
  await expect(composer).toHaveValue('draft');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(composer).toBeFocused();
});

test('the empty changes drawer fills in when the first change arrives', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await askForEdit(page, repo.root);
  await expect(page.locator('.dchip')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+D');
  const drawer = page.locator('.dd');
  const empty = drawer.getByRole('status').filter({ hasText: 'No changes yet' });
  await expect(empty).toBeVisible();
  await expect(drawer).toHaveAccessibleName('Changes');
  await expect(drawer).toBeFocused();

  await allowEdit(page).dispatchEvent('click');
  await expect(drawer).toHaveAccessibleName('Changes · 1 file', { timeout: 60_000 });
  await expect(drawer.getByRole('treeitem', { name: /notes\.txt/ })).toBeVisible();
  await expect(empty).toHaveCount(0);
  await expect(drawer.getByRole('tree', { name: 'Changed files' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('a first change does not pull focus out of the message box', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await askForEdit(page, repo.root);
  await page.keyboard.press('ControlOrMeta+D');
  const drawer = page.locator('.dd');
  await expect(drawer.getByText('No changes yet')).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.focus();

  await allowEdit(page).dispatchEvent('click');
  await expect(drawer).toHaveAccessibleName('Changes · 1 file', { timeout: 60_000 });
  await expect(composer).toBeFocused();
});

test('the empty changes drawer fits a phone', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.setViewportSize({ width: 375, height: 760 });
  await page.keyboard.press('ControlOrMeta+D');
  const drawer = page.getByRole('dialog', { name: 'Changes', exact: true });
  await expect(drawer.getByRole('status')).toContainText('No changes yet');
  const box = (await drawer.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  const stage = (await drawer.locator('.es-stage').boundingBox())!;
  expect(stage.x).toBeGreaterThanOrEqual(box.x);
  expect(stage.x + stage.width).toBeLessThanOrEqual(box.x + box.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
