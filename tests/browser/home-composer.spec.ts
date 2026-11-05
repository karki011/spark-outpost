import path from 'node:path';
import { expect, test, type Page, type Response } from '@playwright/test';
import { openChats } from './navigation.ts';
import { permissionChip, pickerPanel, pickMode } from './permissions-kit.ts';
import { chatRepo, resetWithAgents, type ChatRepo } from './project-chat-kit.ts';

const UNSAVED_DRAFT = /\/api\/conversations\/[0-9a-f-]{36}$/;

let repo: ChatRepo;

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const composer = (page: Page) =>
  page.getByRole('main').getByRole('region', { name: 'Start a new chat' });

async function openHome(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await expect(composer(page)).toBeVisible();
}

function failedApiCalls(page: Page): string[] {
  const failed: string[] = [];
  page.on('response', (response: Response) => {
    const unsavedDraft = response.status() === 404 && UNSAVED_DRAFT.test(response.url());
    if (
      response.url().includes('/api/conversations/') &&
      response.status() >= 400 &&
      !unsavedDraft
    ) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  return failed;
}

test('the Home composer keeps its mode and project across a reload and after a send', async ({
  page,
}) => {
  const added = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(added.ok()).toBe(true);
  const name = path.basename(repo.root);
  await openHome(page);
  const box = composer(page);

  const failed = failedApiCalls(page);
  await page.reload();
  await expect(box.getByRole('button', { name: 'Choose project' })).toBeVisible();
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Plan');
  expect(failed).toEqual([]);

  await permissionChip(page).click();
  await pickMode(page, 'Manual');
  await expect(pickerPanel(page)).toContainText(
    'Agent asks before edits and commands · files stay with this chat',
  );
  await page.keyboard.press('Escape');

  await box.getByRole('button', { name: 'Choose project' }).click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(menu.getByRole('list', { name: 'Linked repos' })).toContainText(name);
  await page.keyboard.press('Escape');
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Manual');

  await page.reload();
  await expect(box.getByRole('button', { name: 'Choose project' })).toHaveCount(0);
  await expect(box.locator('.ctx-repo')).toContainText(name);
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Manual');

  const input = box.getByRole('textbox', { name: 'Message' });
  await input.fill('Read the notes file');
  await input.press('Enter');
  await expect(box.getByRole('status')).toContainText('Started ‘Read the notes file’');
  await expect(box.locator('.ctx-repo')).toContainText(name);
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Manual');

  await page.reload();
  await expect(box.locator('.ctx-repo')).toContainText(name);
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Manual');
  await expect(box.getByRole('textbox', { name: 'Message' })).toHaveValue('');

  const kept = await page.evaluate(() => localStorage.getItem('spark-outpost.home-draft'));
  const sent = await page.request.post(`/api/conversations/${kept}/messages`, {
    data: { id: crypto.randomUUID(), content: 'Sent before the page saved its next draft' },
  });
  expect(sent.ok()).toBe(true);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spark-outpost.home-draft')))
    .not.toBe(kept);
  await expect(box.locator('.ctx-repo')).toContainText(name);
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Manual');
});

test('a chat with no project shows the picked mode and points to projects', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(
    page.locator('.comp-foot').getByRole('button', { name: 'Choose project' }),
  ).toBeVisible();
  const chip = permissionChip(page);
  await expect(chip).not.toHaveText(/No file tools/);

  await chip.click();
  await pickMode(page, 'Auto');
  const tab = pickerPanel(page).getByRole('tab', { name: /Permissions/ });
  await expect(tab).toHaveText(/Auto$/);
  await expect(pickerPanel(page).locator('.mode-line')).toHaveText(
    'Agent decides what to ask · files stay with this chat',
  );
  await page.keyboard.press('Escape');
  await expect(chip).toHaveAccessibleName('Permissions: Auto');
});
