import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { editedChat } from './edited-chat.ts';
import { openChats } from './navigation.ts';
import { slot } from './stub-config.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const PORT = slot === 0 ? 4877 : 20_000 + slot * 10 + 7;
const URL = `http://127.0.0.1:${PORT}`;
const SERVER = `const http = require('node:http');
const port = Number(process.env.PORT);
http
  .createServer((request, response) => {
    console.log('GET ' + request.url);
    response.setHeader('content-type', 'text/html');
    response.end('<h1>Lantern Quay</h1>');
  })
  .listen(port, '127.0.0.1', () => console.log('Lantern Quay listening on ' + port));
`;

test.describe.configure({ timeout: 90_000 });
let root = '';
let name = '';

test.beforeEach(async () => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-preview-ui-')));
  name = path.basename(root);
  writeFileSync(path.join(root, 'server.js'), SERVER);
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^7.0.0' } }),
  );
  mkdirSync(path.join(root, '.claude'));
  writeFileSync(
    path.join(root, '.claude', 'launch.json'),
    JSON.stringify({
      version: '0.0.1',
      configurations: [
        { name: 'site', runtimeExecutable: 'node', runtimeArgs: ['server.js'], port: PORT },
      ],
    }),
  );
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

test.afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function link(page: Page): Promise<string> {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

async function savedPreview() {
  const db = openTestDb();
  try {
    const { rows } = await db.query('SELECT preview FROM projects WHERE root_path = $1', [root]);
    return rows[0]?.preview ?? null;
  } finally {
    await db.end();
  }
}

async function shoot(page: Page, file: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, file) });
}

test('Settings saves a preview per project, from a suggestion or typed, and checks it', async ({
  page,
}) => {
  await link(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Spark' });
  await dialog.getByRole('tab', { name: 'Projects' }).click();
  const group = page.getByRole('group', { name: `Preview in ${name}` });
  await expect(group).toHaveCount(0);
  await page
    .getByRole('list', { name: 'Linked folders' })
    .getByRole('button', { name: new RegExp(`^${name}\\b`) })
    .click();
  await expect(group).toContainText('Not set.');

  const setUp = group.getByRole('button', { name: `Set up the preview of ${name}` });
  await expect(setUp).toHaveAttribute('aria-expanded', 'false');
  await setUp.press('Enter');
  const form = group.getByRole('form', { name: `Preview of ${name}` });
  const command = form.getByLabel('Dev server command');
  const address = form.getByLabel('Address', { exact: true });
  await expect(command).toHaveValue('');

  await form.getByRole('button', { name: 'Save preview' }).click();
  await expect(command).toHaveAttribute('aria-invalid', 'true');
  await expect(form).toContainText('Type the command that starts your dev server');
  await expect(form).toContainText('Type the address.');
  expect(await savedPreview()).toBeNull();

  const suggestions = form.getByRole('group', { name: 'Suggestions' });
  await expect(suggestions.getByRole('button')).toHaveCount(2);
  await suggestions.getByRole('button', { name: /npm run dev/ }).click();
  await expect(command).toHaveValue('npm run dev');
  await expect(address).toHaveValue('http://localhost:5173');
  await suggestions.getByRole('button', { name: /node server\.js/ }).click();
  await expect(command).toHaveValue('node server.js');
  await expect(address).toHaveValue(`http://localhost:${PORT}`);

  await address.fill('https://example.com');
  await form.getByLabel(/Working folder/).fill('../elsewhere');
  await form.getByRole('button', { name: 'Save preview' }).click();
  await expect(form).toContainText('Use an address on this Mac');
  await expect(form).toContainText('Use a folder inside the project');
  await shoot(page, 'browser-preview-settings-errors.png');
  const axe = await new AxeBuilder({ page }).include('.set-project').analyze();
  expect(axe.violations).toEqual([]);

  await address.fill(`127.0.0.1:${PORT}`);
  await form.getByLabel(/Working folder/).fill('');
  await address.press('Enter');
  await expect(form).toBeHidden();
  await expect(group).toContainText(`Spark runs node server.js and opens ${URL}.`);
  expect(await savedPreview()).toEqual({
    command: 'node server.js',
    url: URL,
    folder: null,
    readyUrl: null,
  });
  await shoot(page, 'browser-preview-settings-saved.png');

  await group.getByRole('button', { name: `Edit the preview of ${name}` }).click();
  await expect(group.getByLabel('Dev server command')).toHaveValue('node server.js');
  await group.getByRole('button', { name: 'Remove preview' }).click();
  await expect(group).toContainText('Not set.');
  expect(await savedPreview()).toBeNull();
});

test('the Browser pane starts the preview, shows it as a Preview terminal and stops it @packaged', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const projectId = await link(page);
  const saved = await page.request.put(`/api/projects/${projectId}/preview`, {
    data: { preview: { command: `${process.execPath} server.js`, url: URL } },
  });
  expect(saved.ok()).toBe(true);
  await withDesktopBrowser(page);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const folders = page.getByRole('dialog', { name: 'Project folders' });
  await folders.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await page.keyboard.press('Escape');
  await page.locator('.head-r').getByRole('button', { name: 'Browser' }).click();
  const pane = page.getByRole('region', { name: 'Browser' });

  const preview = pane.getByRole('group', { name: 'Preview', exact: true });
  await expect(preview).toContainText('server.js');
  await shoot(page, 'browser-preview-pane-start.png');
  await preview.getByRole('button', { name: 'Start preview' }).click();
  await expect(preview.getByRole('button', { name: 'Open preview' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => (await calls(page, 'command')).at(-1))
    .toMatchObject({ command: { command: 'navigate', tabId: 't1', url: `${URL}/` } });
  expect((await page.request.get(URL)).status()).toBe(200);

  const live = pane.getByRole('group', { name: 'Preview server' });
  await expect(live).toContainText('Preview running');
  await live.getByRole('button', { name: 'Show output' }).click();
  const dock = page.getByRole('region', { name: 'Terminal' });
  await expect(dock.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dock.locator('.xterm-accessibility')).toContainText(
    `Lantern Quay listening on ${PORT}`,
  );
  await shoot(page, 'browser-preview-pane-running.png');
  const axe = await new AxeBuilder({ page }).include('#work-panel').analyze();
  expect(axe.violations).toEqual([]);

  await dock.getByRole('button', { name: 'Close Preview' }).click();
  await expect(dock).toBeHidden();
  expect((await page.request.get(URL)).status()).toBe(200);

  await live.getByRole('button', { name: 'Stop preview' }).click();
  await expect(live).toBeHidden();
  await expect(preview.getByRole('button', { name: 'Start preview' })).toBeEnabled();
  await expect
    .poll(() =>
      page.request.get(URL).then(
        () => 'up',
        () => 'down',
      ),
    )
    .toBe('down');
});

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function addScreenshot(): Promise<void> {
  const db = openTestDb();
  try {
    const attachment = randomUUID();
    await db.query(
      `INSERT INTO attachments (id, workspace_id, name, media_type, kind, size, data)
       SELECT $1, c.workspace_id, 'browser.png', 'image/png', 'image', $2, $3
       FROM conversations c LIMIT 1`,
      [attachment, PIXEL.length, PIXEL],
    );
    await db.query(
      `INSERT INTO browser_screenshots
         (id, run_id, conversation_id, attachment_id, page, title, width, height, sha256)
       SELECT $1, r.id, r.conversation_id, $2, $3, 'Lantern Quay', 1, 1, repeat('a', 64)
       FROM runs r WHERE r.parent_run_id IS NULL ORDER BY r.created_at LIMIT 1`,
      [randomUUID(), attachment, `${URL}/`],
    );
  } finally {
    await db.end();
  }
}

test('a finished turn says whether the change was checked in the browser', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  writeFileSync(path.join(root, 'notes.txt'), 'Remember the milk\n');
  await withDesktopBrowser(page);
  await editedChat(page, root);
  const turns = page.locator('.crew-turn');
  await expect(turns.first().locator('.crew-foot')).toContainText('Done');
  const kept = turns.first().getByRole('region', { name: /^Kept · / });
  await kept.getByRole('button', { name: /^Kept · / }).click();
  await expect(kept.getByRole('region', { name: /Files changed/ })).toBeVisible();
  await expect(page.getByText('Not checked in browser')).toHaveCount(0);
  await expect(page.getByText('Checked in browser')).toHaveCount(0);

  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Make the Save button wider #edit #build');
  await input.press('Enter');
  await page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(turns.nth(1).locator('.crew-foot')).toContainText('Done', { timeout: 30_000 });
  const second = turns.nth(1).locator('.turn-foot');
  await expect(second.getByText('Not checked in browser')).toBeVisible();
  await expect(turns.first().getByText('Not checked in browser')).toHaveCount(0);
  await shoot(page, 'browser-preview-summary-not-checked.png');

  await addScreenshot();
  await page.reload();
  const checked = turns
    .first()
    .locator('.turn-foot')
    .getByRole('button', { name: 'Checked in browser. Open the screenshot of Lantern Quay' });
  await turns.first().hover();
  await expect(checked).toBeVisible();
  await expect(checked.locator('img')).toHaveJSProperty('complete', true);
  await shoot(page, 'browser-preview-summary-checked.png');
  await checked.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(turns.nth(1).getByText('Not checked in browser')).toBeVisible();
});
