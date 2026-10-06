import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { permissionChip, pickMode } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.M2_SCREENSHOTS ?? '';
const THEMES = [
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'contrast',
  'system',
];

let base = '';
let appRoot = '';
const notes = () => path.join(appRoot, 'notes.txt');

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-approvals-')));
  appRoot = path.join(base, 'app');
  mkdirSync(appRoot);
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  writeFileSync(notes(), 'Remember the milk\n');
  await resetTestDatabase({
    onboarded: true,
    connected: ['claude', 'codex'],
    defaultLevel: 'hands-off',
  });
});

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, `m2-${name}.png`) });
}

async function doChat(page: Page) {
  const response = await page.request.post('/api/projects', { data: { rootPath: appRoot } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /^app/ }).click();
  await expect(menu.getByRole('list', { name: 'Linked repos' })).toContainText('app');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await expect(panel.getByRole('radio', { name: /Fake Fast/ })).toBeVisible();
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  const modes = panel.getByRole('radiogroup', { name: 'Agent mode' });
  await expect(modes.getByRole('radio', { name: 'Plan', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await pickMode(page, 'Manual');
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toHaveText(/Manual$/);
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Manual');
  await shot(page, 'level-picker');
  await page.keyboard.press('Escape');
  return page.getByRole('textbox', { name: 'Message' });
}

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

const card = (page: Page, name: RegExp) => page.getByRole('group', { name });

test('asks before a command and runs it after Allow, from the keyboard', async ({ page }) => {
  await doChat(page);
  await send(page, 'Run the tests #approve');
  const approval = card(page, /Run a command\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await expect(approval.locator('pre')).toHaveText('$ pnpm lint -- groupMessages');
  await expect(approval).toContainText("It isn't on the project's allowlist yet");
  await expect(page.locator('.crew-turn .agent-head', { hasText: 'Bolt' })).toContainText(
    'waiting for you',
  );
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await shot(page, 'approval-command');

  await page.reload();
  const status = page.locator('.cstatus').getByRole('button', { name: /^Waiting for you/ });
  await expect(status).toContainText('approve pnpm lint -- groupMessages');
  const allow = card(page, /Run a command\?/).getByRole('button', { name: 'Allow', exact: true });
  await status.focus();
  await page.keyboard.press('Enter');
  await expect(allow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card(page, /Run a command\?/).getByRole('status')).toContainText('Chose: Allow.');
  await expect(page.locator('.md', { hasText: 'Done. fake-run=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  await page.locator('.crew-turn .agent-head', { hasText: 'Bolt' }).click();
  await page
    .getByRole('button', { name: /worked for|steps/ })
    .first()
    .click();
  await expect(page.getByText('(you allowed it)')).toBeVisible();
});

test('shows the diff for an edit and leaves the file alone after Deny', async ({ page }) => {
  const original = Array.from({ length: 30 }, (_, index) => `Note ${index + 1}`).join('\n');
  writeFileSync(notes(), `${original}\n`);
  await doChat(page);
  await send(page, 'Add a line to the notes #edit');
  const approval = card(page, /Change a file\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  const figure = approval.getByRole('figure');
  await expect(figure).toContainText('notes.txt');
  await expect(figure.locator('.appr-count')).toHaveText('+1 −0');
  await expect(figure.getByText('New file')).toHaveCount(0);
  const added = figure.locator('.dv-row.add');
  await expect(added).toHaveText('31+AddedEdited by the fake agent');
  const rows = figure.locator('.dv-row');
  await expect(rows).toHaveCount(4);
  await figure.getByRole('button', { name: 'Show 27 unchanged lines' }).click();
  await expect(rows).toHaveCount(31);
  await expect(rows.first()).toHaveText('11 Note 1');
  const wrap = figure.getByRole('button', { name: 'Wrap' });
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await expect(figure.getByRole('region', { name: 'Changes to notes.txt' })).toHaveClass(/wrap/);
  await expect(approval.getByRole('button', { name: 'Always allow in this project' })).toHaveCount(
    0,
  );
  await shot(page, 'approval-edit');
  await approval.getByRole('button', { name: 'Deny' }).click();
  await expect(page.locator('.md', { hasText: 'fake-edit=denied' })).toBeVisible({
    timeout: 15_000,
  });
  expect(readFileSync(notes(), 'utf8')).toBe(`${original}\n`);
});

test('marks a new file in the diff', async ({ page }) => {
  rmSync(notes());
  await doChat(page);
  await send(page, 'Start the notes #edit');
  const approval = card(page, /Change a file\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  const figure = approval.getByRole('figure');
  await expect(figure.getByText('New file')).toBeVisible();
  await expect(figure.locator('.dv-row.add')).toHaveText('1+AddedEdited by the fake agent');
  await approval.getByRole('button', { name: 'Deny' }).click();
  await expect(page.locator('.md', { hasText: 'fake-edit=denied' })).toBeVisible({
    timeout: 15_000,
  });
});

test('"Always allow in this project" adds the command to the allowlist', async ({ page }) => {
  await doChat(page);
  await send(page, 'Run the tests #approve');
  await card(page, /Run a command\?/)
    .getByRole('button', { name: 'Always allow in this project' })
    .click();
  await expect(page.locator('.md', { hasText: 'fake-run=allowed' })).toBeVisible({
    timeout: 15_000,
  });

  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /Commands that run without asking/ }).click();
  const list = menu.getByRole('list', { name: 'Allowed commands in app' });
  await expect(list).toContainText('pnpm lint -- groupMessages');
  await shot(page, 'allowlist');
  await page.keyboard.press('Escape');

  await send(page, 'Again #approve');
  await expect(page.locator('.md', { hasText: 'Done. fake-run=allowed' }).nth(1)).toBeVisible({
    timeout: 15_000,
  });
  await expect(card(page, /Run a command\?/)).toHaveCount(1);
  await expect(card(page, /Run a command\?/).getByRole('status')).toContainText(
    'Always allowed in this project.',
  );

  await page.locator('.ctx-repo').click();
  await expect(
    menu.getByRole('button', { name: /Commands that run without asking/ }),
  ).toHaveAttribute('aria-expanded', 'true');
  await list.getByRole('button', { name: 'Remove pnpm lint -- groupMessages' }).click();
  await expect(list).toHaveCount(0);
});

test('Stop while waiting cancels the approval and the run', async ({ page }) => {
  await doChat(page);
  await send(page, 'Run the tests #approve');
  await expect(card(page, /Run a command\?/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.crew-turn .agent-head', { hasText: 'Bolt' })).toContainText(
    'stopped',
    { timeout: 15_000 },
  );
  await expect(card(page, /Run a command\?/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('reverts an allowed edit after one confirmation', async ({ page }) => {
  await doChat(page);
  await send(page, 'Add a line to the notes #edit');
  await card(page, /Change a file\?/)
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(page.locator('.md', { hasText: 'fake-edit=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  expect(readFileSync(notes(), 'utf8')).toContain('Edited by the fake agent');
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toContainText('Kept automatically.');
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await panel.getByRole('tab', { name: 'Changes' }).click();
  await expect(panel.getByRole('tab', { name: 'Changes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const changed = panel.getByRole('region', { name: 'Most changed files' });
  await expect(changed).toContainText('notes.txt');
  await expect(changed).toContainText('+1 −0');
  await shot(page, 'changes-tab');

  await page.getByRole('button', { name: 'Revert to before this run' }).click();
  const confirm = page.getByRole('group', { name: 'Revert to before this run' });
  await expect(confirm).toContainText('Revert 1 file?');
  await expect(confirm.getByRole('listitem')).toHaveText('notes.txt changed');
  await expect(confirm.getByRole('button', { name: 'Revert', exact: true })).toBeFocused();
  await shot(page, 'revert-confirm');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Reverted 1 file.')).toBeVisible();
  expect(readFileSync(notes(), 'utf8')).toBe('Remember the milk\n');
});

test('Codex offers Do with its own copy', async ({ page }) => {
  await doChat(page);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('tab', { name: 'Codex' }).click();
  await expect(panel.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true');
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  const modes = panel.getByRole('radiogroup', { name: 'Agent mode' });
  await expect(modes.getByRole('radio')).toHaveText([
    /^Read-only/,
    /^Ask every time/,
    /^Approve for me/,
    /^Full access/,
  ]);
  await expect(modes.getByRole('radio', { name: 'Read-only', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await pickMode(page, 'Full access');
  await expect(permissionChip(page)).toHaveClass(/risk-full/);
  await pickMode(page, 'Approve for me');
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Approve for me');
  await expect(panel.getByRole('note')).toContainText('ran without review');
  await pickMode(page, 'Ask every time');
  await expect(modes.getByRole('radio', { name: 'Ask every time', exact: true })).toContainText(
    'Commands run in a workspace-write sandbox without network',
  );
  await expect(panel.getByRole('note')).toHaveCount(0);
  await expect(panel).toContainText('Agent asks before edits and commands');
  await shot(page, 'codex-do');
  await page.keyboard.press('Escape');
  await send(page, 'Run the tests #approve');
  const approval = card(page, /Run a command\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await expect(approval).not.toContainText('sandbox');
  await approval.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.locator('.md', { hasText: 'fake-run=denied' })).toBeVisible({
    timeout: 15_000,
  });
});

test('the approval card works on a phone and in every theme', async ({ page }) => {
  test.setTimeout(60_000);
  await doChat(page);
  await send(page, 'Run the tests #approve');
  const approval = card(page, /Run a command\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await approval.scrollIntoViewIfNeeded();
  const box = await approval.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await shot(page, 'mobile');
  await page.setViewportSize({ width: 1100, height: 760 });
  for (const theme of THEMES) {
    await page.evaluate((skin) => {
      if (skin === 'system') delete document.documentElement.dataset.skin;
      else document.documentElement.dataset.skin = skin;
    }, theme);
    await expect(approval).toBeVisible();
    await shot(page, `theme-${theme}`);
  }
  await approval.getByRole('button', { name: 'Deny' }).click();
});

test('asks to hold before a force push and never offers Always allow', async ({ page }) => {
  await doChat(page);
  await send(page, 'Update the branch #leasepush');
  const approval = card(page, /Force push\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await expect(approval.locator('pre')).toHaveText('$ git push --force-with-lease origin feature');
  await expect(approval).toContainText(
    'This rewrites history on feature on the remote, whatever your permissions.',
  );
  await expect(approval.getByRole('button', { name: /Always allow/ })).toHaveCount(0);
  await expect(approval.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
  const hold = approval.getByRole('button', { name: 'Hold to force push' });
  await hold.focus();
  await page.keyboard.down(' ');
  await page.waitForTimeout(300);
  await page.keyboard.up(' ');
  await expect(approval).toContainText('Released early. Nothing was pushed.');
  await expect(approval.getByRole('status')).toHaveCount(0);
  await hold.focus();
  await page.keyboard.down(' ');
  await expect(card(page, /Force push\?/).getByRole('status')).toContainText('Chose: Allow.', {
    timeout: 5_000,
  });
  await page.keyboard.up(' ');
  await expect(page.locator('.md', { hasText: 'Done. fake-force-push=allowed' })).toBeVisible({
    timeout: 15_000,
  });
});

test('asks before an agent instruction file, with Allow once, for this chat, or Deny', async ({
  page,
}) => {
  const agents = path.join(appRoot, 'AGENTS.md');
  rmSync(agents, { force: true });
  await doChat(page);
  await send(page, 'Tighten the agent rules #instructions');
  const approval = card(page, /Change agent instructions\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await expect(approval).toContainText('wants to change AGENTS.md');
  await expect(approval.getByRole('figure')).toContainText('Edited by the fake agent');
  await expect(approval).toContainText('always ask, whatever your permissions.');
  await expect(approval.getByRole('button', { name: /Always allow/ })).toHaveCount(0);
  await expect(approval.getByRole('button', { name: 'Allow once' })).toBeVisible();
  await expect(approval.getByRole('button', { name: 'Deny' })).toBeVisible();
  await approval.getByRole('button', { name: 'Deny' }).click();
  await expect(page.locator('.md', { hasText: 'fake-instructions=denied' })).toBeVisible({
    timeout: 15_000,
  });
  expect(existsSync(agents)).toBe(false);

  await send(page, 'Try again #instructions');
  const chatAllow = card(page, /Change agent instructions\?/).getByRole('button', {
    name: 'Allow for this chat',
  });
  await chatAllow.click({ timeout: 15_000 });
  await expect(
    card(page, /Change agent instructions\?/)
      .getByRole('status')
      .last(),
  ).toContainText('Allowed for this chat.');
  await expect(page.locator('.md', { hasText: 'fake-instructions=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  expect(readFileSync(agents, 'utf8')).toBe('Edited by the fake agent\n');
  await expect(page.locator('.crew-turn .crew-foot').last()).toContainText('Done', {
    timeout: 15_000,
  });

  await send(page, 'Once more #instructions');
  const third = card(page, /Change a file\?/);
  await expect(third).toBeVisible({ timeout: 15_000 });
  await expect(third).not.toContainText('always ask');
  await third.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.locator('.md', { hasText: 'fake-instructions=allowed' }).nth(1)).toBeVisible({
    timeout: 15_000,
  });
});

test('a shell write to an agent instruction file gets the same three choices', async ({ page }) => {
  rmSync(path.join(appRoot, 'AGENTS.md'), { force: true });
  await doChat(page);
  await send(page, 'Note the test runner in the agent rules #shellinstructions');
  const approval = card(page, /Change agent instructions\?/);
  const buttons = ['Allow once', 'Allow for this chat', 'Deny'];
  await expect(approval.getByRole('button')).toHaveText(buttons, { timeout: 15_000 });
  await approval.getByRole('button', { name: 'Allow for this chat' }).click();
  const done = page.locator('.md', { hasText: 'fake-instructions-shell=allowed' });
  await expect(done).toBeVisible({ timeout: 15_000 });
  expect(readFileSync(path.join(appRoot, 'AGENTS.md'), 'utf8')).toBe('- Tests use node --test.\n');
});

test('asks to hold before changing a git hook and allows it once only', async ({ page }) => {
  const hook = path.join(appRoot, '.git', 'hooks', 'pre-commit');
  rmSync(path.join(appRoot, '.git'), { recursive: true, force: true });
  await doChat(page);
  await send(page, 'Add a pre-commit hook #githook');
  const approval = card(page, /Change git hooks or config\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await expect(approval).toContainText('wants to change .git/hooks/pre-commit');
  await expect(approval).toContainText('outside Spark');
  await expect(approval.getByRole('button', { name: /Allow/ })).toHaveCount(0);
  const hold = approval.getByRole('button', { name: 'Hold to allow once' });
  await hold.focus();
  await page.keyboard.down(' ');
  await page.waitForTimeout(300);
  await page.keyboard.up(' ');
  await expect(approval).toContainText('Released early. Nothing was changed.');
  expect(existsSync(hook)).toBe(false);
  await hold.focus();
  await page.keyboard.down(' ');
  await expect(card(page, /Change git hooks or config\?/).getByRole('status')).toContainText(
    'Chose: Allow.',
    { timeout: 5_000 },
  );
  await page.keyboard.up(' ');
  await expect(page.locator('.md', { hasText: 'fake-hook=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  expect(readFileSync(hook, 'utf8')).toBe('Edited by the fake agent\n');
});

async function askChat(page: Page) {
  const response = await page.request.post('/api/projects', { data: { rootPath: appRoot } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /^app/ }).click();
  await page.keyboard.press('Escape');
  await expect(permissionChip(page)).toHaveText('Plan');
}

test('reads .env without a card, then asks before curl at Automatic', async ({ page }) => {
  await askChat(page);
  await send(page, 'Check the site #readenv #curl');
  const sending = page.locator('.appr', { hasText: '$ curl -sI https://example.com' });
  await expect(sending).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.appr', { hasText: '$ cat .env' })).toHaveCount(0);
  await expect(sending.locator('.appr-observed')).toHaveText('Read sensitive data earlier: .env');
  await expect(sending.locator('.appr-reason')).toContainText(
    'This run read .env earlier; sending data to example.com needs your OK',
  );
  await expect(sending.getByRole('button', { name: 'Always allow in this project' })).toHaveCount(
    0,
  );
  await sending.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(
    page.locator('.md', { hasText: 'Done. fake-read-env=allowed fake-curl=allowed' }),
  ).toBeVisible({ timeout: 15_000 });
});

test('runs a command in an Ask chat at Automatic without asking', async ({ page }) => {
  await askChat(page);
  await send(page, 'Check the site #curl');
  await expect(page.locator('.md', { hasText: 'Done. fake-curl=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(card(page, /Run a command\?/)).toHaveCount(0);
  expect(readFileSync(notes(), 'utf8')).toBe('Remember the milk\n');
});
