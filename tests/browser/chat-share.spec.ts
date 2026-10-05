import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.SPARK_CHAT_SHARE_SHOTS;
const SCHEME = 'spark-outpost';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-chat-share-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const linkTo = (chatId: string) => `${SCHEME}://chat/${chatId}`;
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const chips = (page: Page) => page.locator('.composer').getByRole('group', { name: 'Attachments' });
const chip = (page: Page, title: string) => chips(page).locator('.att-chip', { hasText: title });

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `chat-share-${name}.png`) });
}

async function createProject(page: Page, name: string) {
  const folder = path.join(base, name);
  mkdirSync(folder);
  const response = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; name: string };
}

async function newChat(page: Page) {
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  return input;
}

async function paste(page: Page, text: string): Promise<boolean> {
  return page.getByRole('textbox', { name: 'Message' }).evaluate((element, pasted) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', pasted);
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, text);
}

test('copies a chat link from the row menu and from the chat header', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const [chatId] = await seedChats([{ title: 'Fix the login page', run: { status: 'succeeded' } }]);
  await openChats(page);
  const row = sidebar(page).getByRole('listitem').filter({ hasText: 'Fix the login page' });

  await row.hover();
  await sidebar(page).getByRole('button', { name: 'Options for Fix the login page' }).click();
  const menu = page.getByRole('menu', { name: 'Options for Fix the login page' });
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
  await shot(page, 'row-menu');
  await menu.getByRole('menuitem', { name: 'Copy chat link' }).click();

  await expect(
    sidebar(page).getByRole('status').filter({ hasText: 'Chat link copied.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(linkTo(chatId!));

  await page.evaluate(() => navigator.clipboard.writeText('cleared'));
  await row.click();
  await page.getByRole('button', { name: 'Chat actions' }).click();
  const headerMenu = page.getByRole('menu').filter({ hasText: 'Audit this chat' });
  await expect(headerMenu.getByRole('menuitem')).toHaveText([
    'Audit this chat',
    'Start fresh',
    'Copy chat link',
  ]);
  await page.keyboard.press('ArrowUp');
  await expect(headerMenu.getByRole('menuitem', { name: 'Copy chat link' })).toBeFocused();
  await shot(page, 'header-menu');
  await page.keyboard.press('Enter');

  await expect(page.locator('.toast.floating', { hasText: 'Chat link copied.' })).toBeVisible();
  await shot(page, 'copied-toast');
  await expect(page.getByRole('button', { name: 'Chat actions' })).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(linkTo(chatId!));
});

test('a pasted chat link becomes a chip and the sent message carries a short context block', async ({
  page,
}) => {
  await openChats(page);
  const project = await createProject(page, 'storefront');
  const [otherId] = await seedChats([
    { title: 'Fix the login page', projectIds: [project.id], run: { status: 'running' } },
  ]);
  await page.reload();
  const input = await newChat(page);

  expect(await paste(page, linkTo(otherId!))).toBe(true);

  const shared = chip(page, 'Fix the login page');
  await expect(shared).toContainText(`${project.name} · Running`);
  await expect(shared).toHaveAttribute('data-chat', 'working');
  await expect(input).toHaveValue('');
  await shot(page, 'chip-running');

  await input.fill('What is that chat doing?');
  await input.press('Enter');

  await expect(page.locator('.msg.ai').last()).toContainText(
    'Attachments: Spark chat - Fix the login page.md.',
    { timeout: 20_000 },
  );
  await expect(chips(page).locator('.att-chip')).toHaveCount(0);
  await shot(page, 'sent');

  const chats = (await (await page.request.get('/api/conversations')).json()) as {
    id: string;
    title: string;
  }[];
  const mine = chats.find((chat) => chat.id !== otherId)!;
  const detail = (await (await page.request.get(`/api/conversations/${mine.id}`)).json()) as {
    messages: { role: string; content: string; attachments: { id: string; name: string }[] }[];
  };
  const sent = detail.messages.find((message) => message.role === 'user')!;
  expect(sent.content).toBe('What is that chat doing?');
  expect(sent.attachments.map((attachment) => attachment.name)).toEqual([
    'Spark chat - Fix the login page.md',
  ]);
  const block = await (
    await page.request.get(`/api/attachments/${sent.attachments[0]!.id}/content`)
  ).text();
  expect(block.length).toBeLessThanOrEqual(4_000);
  expect(block).toContain('# Shared Spark chat: Fix the login page');
  expect(block).toContain('quoted from another Spark chat');
  expect(block).toContain(`Chat id: ${otherId}`);
  expect(block).toContain(`Projects: ${project.name}`);
  expect(block).toContain('State: Running. As of ');
  expect(block).toContain('still running');
  expect(block).toContain(`spark_chat with {"chat":"${otherId}","digest":true}`);
  expect(block).toContain(`spark_chat_history with {"chat":"${otherId}"}`);

  const other = (await (await page.request.get(`/api/conversations/${otherId}`)).json()) as {
    messages: unknown[];
    runs: { status: string }[];
  };
  expect(other.messages).toHaveLength(1);
  expect(other.runs.map((run) => run.status)).toEqual(['running']);
});

test('the chip shows each state, and a deleted chat or this chat gives a clear message', async ({
  page,
}) => {
  const [running, waiting, done, failed, archived] = await seedChats([
    { title: 'Running chat', run: { status: 'running' } },
    {
      title: 'Waiting chat',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm test', command: 'pnpm test' },
    },
    { title: 'Done chat', run: { status: 'succeeded' } },
    { title: 'Failed chat', run: { status: 'failed', error: 'The agent stopped.' } },
    { title: 'Archived chat', archived: true, run: { status: 'succeeded' } },
    { title: 'Idle chat' },
  ]);
  await openChats(page);
  await newChat(page);

  for (const id of [running, waiting, done, failed, archived]) await paste(page, linkTo(id!));

  await expect(chip(page, 'Running chat')).toContainText('No project · Running');
  await expect(chip(page, 'Waiting chat')).toContainText('No project · Waiting for you');
  await expect(chip(page, 'Done chat')).toContainText('No project · Done');
  await expect(chip(page, 'Failed chat')).toContainText('No project · Stopped with an error');
  await expect(chip(page, 'Archived chat')).toContainText('No project · Archived');
  await shot(page, 'chip-states');

  await paste(page, linkTo(running!));
  await expect(chips(page).locator('.att-chip')).toHaveCount(5);

  await page.getByRole('button', { name: 'Remove Running chat' }).click();
  await expect(chip(page, 'Running chat')).toHaveCount(0);

  await paste(page, linkTo(randomUUID()));
  const gone = chips(page).locator('.att-chip.failed');
  await expect(gone).toContainText('That chat does not exist. It may have been deleted.');
  await expect(gone.getByRole('button', { name: /^Retry/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await shot(page, 'chip-deleted');
  await gone.getByRole('button', { name: /^Remove/ }).click();

  expect(await paste(page, `see ${linkTo(done!)} please`)).toBe(false);
  expect(await paste(page, done!)).toBe(false);
});

test('adds another chat from the plus menu with the keyboard', async ({ page }) => {
  await seedChats([
    { title: 'Fix the login page', run: { status: 'succeeded' } },
    { title: 'Write release notes', run: { status: 'running' } },
    { title: 'Old experiment', archived: true },
  ]);
  await openChats(page);
  await newChat(page);

  await page.getByRole('button', { name: 'Add files and context' }).click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Upload a file',
    'Add a screenshot',
    /Add from repo/,
    'Add a repo…',
    'Add another chat…',
  ]);
  await page.getByRole('menuitem', { name: 'Add another chat…' }).click();

  const picker = page.getByRole('dialog', { name: 'Add another chat' });
  const search = picker.getByRole('combobox', { name: 'Search chats' });
  await expect(search).toBeFocused();
  await expect(picker.getByRole('option')).toHaveCount(2);
  await expect(picker.getByRole('option', { name: /Old experiment/ })).toHaveCount(0);
  await expect(picker).toHaveCSS('opacity', '1');
  await expect(page.getByRole('menu', { name: 'Add files and context' })).toBeHidden();
  await shot(page, 'picker');

  await search.fill('release');
  await expect(picker.getByRole('option')).toHaveText([/Write release notes.*Running/]);
  await search.press('Enter');

  await expect(picker).toHaveCount(0);
  await expect(chip(page, 'Write release notes')).toContainText('Running');

  await page.getByRole('button', { name: 'Add files and context' }).click();
  await page.getByRole('menuitem', { name: 'Add another chat…' }).click();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add files and context' })).toBeFocused();
});

test('pasting the link of the chat you are in explains instead of adding a chip', async ({
  page,
}) => {
  const [chatId] = await seedChats([{ title: 'Fix the login page' }]);
  await openChats(page);
  await sidebar(page).getByRole('listitem').filter({ hasText: 'Fix the login page' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();

  expect(await paste(page, linkTo(chatId!))).toBe(true);

  await expect(page.getByText('That link is this chat.')).toBeVisible();
  await expect(chips(page).locator('.att-chip')).toHaveCount(0);
});
