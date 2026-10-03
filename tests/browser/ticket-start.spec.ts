import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { connectTickets, openTickets, resetTicketFakes } from './ticket-seed.ts';

test.describe.configure({ timeout: 120_000 });

const SHOTS = 'test-results/ticket-start';
let base = '';

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const startDialog = (page: Page) => page.getByRole('dialog', { name: 'Start work on ENG-1210' });

test.beforeEach(async () => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-ticket-start-')));
  mkdirSync(path.join(base, 'web', 'reports'), { recursive: true });
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await resetTicketFakes();
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function openStart(page: Page) {
  await connectTickets(page, ['linear']);
  await openTickets(page);
  await row(page, 'ENG-1210').hover({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Start ENG-1210' }).click();
  return startDialog(page);
}

test('Add context takes a note, links, files and folders, and the chat gets a short brief', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const response = await page.request.post('/api/projects', {
    data: { rootPath: path.join(base, 'web') },
  });
  expect(response.ok()).toBe(true);
  const dialog = await openStart(page);

  const toggle = dialog.getByRole('button', { name: /^Add context/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('note, links, files, folders');
  await expect(dialog.getByLabel('Note')).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await dialog.getByLabel('Note').fill('Keep the copy short and friendly.');
  const linkInput = dialog.getByRole('textbox', { name: 'Link URL' });
  await linkInput.fill('notaurl');
  await linkInput.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Use a full web address');
  await linkInput.fill('https://docs.example.com/settings-copy');
  await linkInput.press('Enter');
  await linkInput.fill('https://example.com/remove-me');
  await dialog.getByRole('button', { name: 'Add link' }).click();
  const references = dialog.getByRole('list', { name: 'References' });
  await expect(references.getByRole('listitem')).toHaveCount(2);
  await references.getByRole('button', { name: 'Remove https://example.com/remove-me' }).click();
  await expect(references.getByRole('listitem')).toHaveCount(1);

  const files = dialog.getByLabel('Add files');
  await files.setInputFiles([
    { name: 'copy-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Tone\nFriendly.') },
    { name: '.env', mimeType: 'text/plain', buffer: Buffer.from('API_TOKEN=abc') },
  ]);
  const attachments = dialog.getByRole('group', { name: 'Attachments' });
  await expect(attachments).toContainText('copy-notes.md');
  await expect(attachments).toContainText('Spark never reads secret files like .env.');
  await expect(dialog.getByRole('button', { name: 'Start with a plan' })).toBeDisabled();
  await expect(dialog).toContainText("Remove the files that couldn't be attached.");
  await attachments.getByRole('button', { name: 'Remove .env' }).click();
  await expect(attachments).not.toContainText('.env');

  await dialog.getByRole('button', { name: 'Project folder' }).click();
  await page.getByRole('menuitemradio', { name: 'web' }).click();
  await dialog.getByRole('button', { name: 'Add folder' }).click();
  const folders = page.getByRole('dialog', { name: 'Add a folder' });
  await folders
    .getByRole('list', { name: 'Folders' })
    .getByRole('button', { name: 'reports' })
    .click();
  await folders.getByRole('button', { name: 'Add this folder' }).click();
  await expect(folders).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add folder' })).toBeFocused();
  await expect(references.getByRole('listitem')).toHaveCount(2);
  await expect(references).toContainText('reports');
  await expect(toggle).toContainText('4 added');

  await dialog.getByRole('button', { name: 'Start with a plan' }).click();
  await expect(page.locator('.chat-title')).toContainText('ENG-1210', { timeout: 15_000 });
  const brief = page.locator('.msg.me').first();
  await expect(brief).toContainText('Ticket data from Linear');
  await expect(brief).toContainText('untrusted third-party text');
  await expect(brief).toContainText('spark_tickets');
  await expect(brief).toContainText('Keep the copy short and friendly.');
  await expect(brief).toContainText('https://docs.example.com/settings-copy');
  await expect(brief).toContainText(path.join(base, 'web', 'reports'));
  await expect(brief).toContainText('copy-notes.md');

  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await panel.getByRole('tab', { name: 'Links' }).click();
  await expect(panel.getByRole('link', { name: /docs\.example\.com/ })).toContainText(
    'Added by you',
  );
  await expect(panel.getByRole('link', { name: /copy-notes\.md/ })).toContainText('File');
  await expect(panel.getByText(`Folder · ${path.join(base, 'web', 'reports')}`)).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Start work dialog, collapsed and expanded, in ${scheme}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 860 });
    mkdirSync(SHOTS, { recursive: true });
    const dialog = await openStart(page);
    await expect(dialog.getByRole('radio', { name: 'Plan first' })).toBeFocused();
    await dialog.screenshot({ path: `${SHOTS}/collapsed-${scheme}.png` });

    await dialog.getByRole('button', { name: /^Add context/ }).click();
    await dialog.getByLabel('Note').fill('Match the tone of the billing page.');
    await dialog
      .getByRole('textbox', { name: 'Link URL' })
      .fill('https://docs.example.com/settings-copy');
    await dialog.getByRole('button', { name: 'Add link' }).click();
    await dialog
      .getByLabel('Add files')
      .setInputFiles([
        { name: 'tone.md', mimeType: 'text/markdown', buffer: Buffer.from('Friendly.') },
      ]);
    await expect(dialog.getByRole('group', { name: 'Attachments' })).toContainText('tone.md');
    await dialog.screenshot({ path: `${SHOTS}/expanded-${scheme}.png` });
  });
}
