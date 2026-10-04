import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { pickPermission, send } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { FAKE_GH_STATE } from './stub-config.ts';
import { connectTickets, openTickets, resetTicketFakes, STUB_URL } from './ticket-seed.ts';

test.describe.configure({ timeout: 120_000 });
let base = '';

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const chip = (page: Page, key: string) =>
  page.locator('.head').getByRole('group', { name: `Linked ticket ${key}` });

interface FakePullSeen {
  title: string;
  body: string;
  head: string;
}

test.beforeEach(async ({ request }) => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-ticket-chat-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await resetTicketFakes();
  await request.post(`${STUB_URL}/github-test/reset`);
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(FAKE_GH_STATE, { force: true });
});

async function addProject(page: Page, root: string) {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
}

async function askBeforeEdits(page: Page) {
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
}

async function newChatOn(page: Page, root: string | null) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  if (!root) return;
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(root)}`) }).click();
  await page.keyboard.press('Escape');
  await askBeforeEdits(page);
}

async function editAndKeep(page: Page, text: string) {
  await send(page, text);
  await page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(page.getByRole('group', { name: /Keep these changes\?/ }).last()).toContainText(
    'Kept automatically.',
    { timeout: 20_000 },
  );
  await expect(page.locator('.crew-turn .crew-foot').last()).toContainText('Done', {
    timeout: 20_000,
  });
}

async function shipDraft(page: Page) {
  await page.locator('.ship-btn').last().click();
  const panel = page.getByRole('group', { name: 'Ship this task' });
  await panel.getByRole('button', { name: 'Open PR' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Opened (draft )?PR #1\./ })).toBeVisible(
    {
      timeout: 20_000,
    },
  );
}

async function pulls(page: Page): Promise<FakePullSeen[]> {
  return (await (await page.request.get(`${STUB_URL}/github-test/pulls`)).json()) as FakePullSeen[];
}

async function refreshTickets(page: Page) {
  await main(page).getByRole('button', { name: 'Refresh tickets' }).click();
}

test('Start work links the chat, Ship puts the PR on the ticket, and a merge moves it to Done', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'widgets');
  writeFileSync(FAKE_GH_STATE, 'octo-cli');
  await addProject(page, repo.root);
  await connectTickets(page, ['linear']);
  await openTickets(page);

  await row(page, 'ENG-1210').hover({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Start ENG-1210' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start work on ENG-1210' });
  await dialog.getByRole('radio', { name: 'Build' }).click();
  await dialog.getByRole('button', { name: 'Project folder' }).click();
  await page.getByRole('menuitemradio', { name: 'widgets' }).click();
  await dialog.getByRole('button', { name: 'Start building' }).click();

  await expect(page.locator('.chat-title')).toContainText('ENG-1210', { timeout: 15_000 });
  await expect(chip(page, 'ENG-1210')).toContainText(/ENG-1210\s*· Tidy the settings copy/);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  await askBeforeEdits(page);
  await editAndKeep(page, 'Add a line to the notes #edit #plan');
  await expect(page.locator('.ctxbar .chat-branch .ctx-branch-name')).toHaveText(
    /^spark\/eng-1210-/,
  );
  await page.request.patch('/api/profile', { data: { prReadyForReview: false } });
  await shipDraft(page);
  const [pull] = await pulls(page);
  expect(pull!.head).toMatch(/^spark\/eng-1210-/);
  expect(pull!.title).toContain('ENG-1210');
  expect(pull!.body).toContain('[ENG-1210](https://linear.app/acme/issue/ENG-1210)');

  await chip(page, 'ENG-1210')
    .getByRole('button', { name: /^ENG-1210/ })
    .click();
  const detail = page.getByRole('complementary', { name: 'ENG-1210 details' });
  await expect(detail).toContainText('acme/widgets #1', { timeout: 15_000 });
  await expect(detail).toContainText('Draft', { timeout: 15_000 });
  const ticketRow = row(page, 'ENG-1210');
  await expect(
    ticketRow.getByRole('button', { name: /^Open PR #1 for ENG-1210, draft, in your browser/ }),
  ).toBeVisible();
  const chatLink = ticketRow.getByRole('button', { name: /^Open the chat for ENG-1210/ });
  await expect(chatLink).toBeVisible();

  await page.request.patch('/api/tickets/connections/linear', { data: { moveOnMerge: false } });
  await page.request.post(`${STUB_URL}/github-test/pulls/1`, {
    data: { merged: true, state: 'closed' },
  });
  await refreshTickets(page);
  const done = main(page).getByRole('region', { name: 'Done recently' });
  await done.getByRole('button', { name: /^Done recently/ }).click({ timeout: 15_000 });
  await expect(
    ticketRow.getByRole('button', { name: /^Open PR #1 for ENG-1210, merged/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(ticketRow).toContainText('PR #1 merged');

  await page.request.patch('/api/tickets/connections/linear', { data: { moveOnMerge: true } });
  await refreshTickets(page);
  await expect(ticketRow).not.toContainText('PR #1 merged', { timeout: 15_000 });
  await expect(done).toContainText('ENG-1210');

  await chatLink.click();
  await expect(page.locator('.chat-title')).toContainText('ENG-1210');
});

test('a chat that fixes a ticket links itself, shows on the ticket and ships with the key', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'widgets');
  writeFileSync(FAKE_GH_STATE, 'octo-cli');
  await addProject(page, repo.root);
  await connectTickets(page, ['linear']);
  await newChatOn(page, repo.root);

  await editAndKeep(page, 'Fix the session expiry bug in WEB-433 #edit #plan');
  await expect(chip(page, 'WEB-433')).toContainText('Session expires during long uploads');
  await expect(page.locator('.ctxbar .chat-branch .ctx-branch-name')).toHaveText(
    /^spark\/web-433-fix-the-session-expiry-bug/,
  );
  await shipDraft(page);
  const [pull] = await pulls(page);
  expect(pull!.title).toContain('WEB-433');
  expect(pull!.body).toContain('## Tickets\n- [WEB-433](https://linear.app/acme/issue/WEB-433)');

  await openTickets(page);
  const ticketRow = row(page, 'WEB-433');
  await expect(
    ticketRow.getByRole('button', { name: /^Open the chat for WEB-433: Fix the session expiry/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(ticketRow.getByRole('button', { name: /^Open PR #1 for WEB-433/ })).toBeVisible();
});

test('several tickets or a reference only suggest, and Unlink sticks', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'widgets');
  await addProject(page, repo.root);
  await connectTickets(page, ['linear', 'jira']);
  await newChatOn(page, repo.root);

  await send(page, 'Fix WEB-433 and ENG-1210');
  const suggestions = page.getByRole('group', { name: 'Suggested tickets' });
  await expect(suggestions.getByRole('button', { name: /^WEB-433/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(suggestions).toContainText(/Link this chat to\s*WEB-433.*ENG-1210/);
  await expect(page.locator('.head .chat-ticket')).toHaveCount(0);
  await suggestions.getByRole('button', { name: /^ENG-1210/ }).click();
  await expect(chip(page, 'ENG-1210')).toBeVisible();
  await expect(suggestions.getByRole('button', { name: /^ENG-1210/ })).toHaveCount(0);
  await suggestions.getByRole('button', { name: 'Not now' }).click();
  await expect(suggestions).toHaveCount(0);

  await chip(page, 'ENG-1210')
    .getByRole('button', { name: 'Unlink ENG-1210 from this chat' })
    .click();
  await expect(chip(page, 'ENG-1210')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Unlinked ENG-1210' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.chat-title')).toContainText('Fix WEB-433');
  await expect(page.locator('.head .chat-ticket')).toHaveCount(0);

  await newChatOn(page, repo.root);
  await send(page, 'Similar to WEB-433, fix the signup form');
  await expect(page.getByRole('group', { name: 'Suggested tickets' })).toContainText('WEB-433', {
    timeout: 20_000,
  });
  await expect(page.locator('.head .chat-ticket')).toHaveCount(0);

  await newChatOn(page, null);
  await send(page, 'Analyse WEB-433 for me');
  const mentions = page.getByRole('group', { name: 'Tickets this message mentions' });
  await expect(mentions).toContainText(/Mentions\s*WEB-433\s*Session expires during long uploads/, {
    timeout: 20_000,
  });
  await expect(page.locator('.head .chat-ticket')).toHaveCount(0);
  await mentions.getByRole('button', { name: /^Link this chat/ }).click();
  await expect(chip(page, 'WEB-433')).toBeVisible();

  await newChatOn(page, null);
  await send(page, `What changed in ${STUB_URL}/browse/API-84 ?`);
  await expect(page.getByRole('group', { name: 'Tickets this message mentions' })).toContainText(
    'API-84',
    { timeout: 20_000 },
  );

  await newChatOn(page, null);
  await send(page, 'Fix NOPE-404 today');
  await expect(page.locator('.chat-title')).toContainText('NOPE-404');
  await expect(page.locator('.chat-ticket-bar')).toHaveCount(0);
  await expect(page.locator('.head .chat-ticket')).toHaveCount(0);
});
