import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { emitVoice, installFakeVoice, voiceCalls, voiceRouting } from './fake-voice.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

async function userMessages(): Promise<number> {
  const db = openTestDb();
  try {
    const result = await db.query(`SELECT count(*)::int AS n FROM messages WHERE role = 'user'`);
    return result.rows[0].n as number;
  } finally {
    await db.end();
  }
}

async function calls(page: Page, op: string) {
  const all = [...(await voiceCalls(page)), ...(await voiceRouting(page))];
  return all.filter((call) => call.op === op);
}

async function openChat(page: Page, title: string) {
  await openChats(page);
  await page.getByRole('navigation', { name: 'Chats' }).getByText(title).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
}

test('a shortcut press in a chat dictates into its message box and sends nothing', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Write the release notes' }]);
  await installFakeVoice(page);
  await openChat(page, 'Write the release notes');
  const before = await userMessages();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Check this branch.');
  await expect.poll(async () => (await calls(page, 'setPressTarget')).at(-1)?.args).toEqual([true]);

  await emitVoice(page, { kind: 'press' });
  await expect(page.getByRole('button', { name: 'Stop dictating' })).toBeVisible();
  expect((await calls(page, 'listen')).map((call) => call.args[0])).toEqual(['dictation']);
  expect(await calls(page, 'pressIsland')).toEqual([]);

  await emitVoice(page, { kind: 'partial', id: 'listen-1', text: 'then update' });
  await expect(input).toHaveValue('Check this branch. then update');
  await emitVoice(page, {
    kind: 'final',
    id: 'listen-1',
    text: 'Then update the docs.',
    reason: 'stopped',
  });
  await expect(input).toHaveValue('Check this branch. Then update the docs.');
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeVisible();
  expect(await userMessages()).toBe(before);
});

test('a second press while dictating stops it through the same button', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Write the release notes' }]);
  await installFakeVoice(page);
  await openChat(page, 'Write the release notes');
  await emitVoice(page, { kind: 'press' });
  await expect(page.getByRole('button', { name: 'Stop dictating' })).toBeVisible();
  await emitVoice(page, { kind: 'press' });
  await expect
    .poll(async () => (await calls(page, 'stop')).map((call) => call.args[0]))
    .toEqual(['listen-1']);
});

test('a press on Home dictates into its message box', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeVisible();
  await emitVoice(page, { kind: 'press' });
  await expect
    .poll(async () => (await calls(page, 'listen')).map((call) => call.args[0]))
    .toEqual(['dictation']);
  await emitVoice(page, {
    kind: 'final',
    id: 'listen-1',
    text: 'Fix the login page.',
    reason: 'stopped',
  });
  await expect(input).toHaveValue('Fix the login page.');
});

test('a press on a screen with no message box goes to the island', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Write the release notes' }]);
  await installFakeVoice(page);
  await openChat(page, 'Write the release notes');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Settings/ })
    .click();
  await expect(page.locator('[aria-modal="true"]')).toBeVisible();

  await emitVoice(page, { kind: 'press' });
  await expect.poll(async () => (await calls(page, 'pressIsland')).length).toBe(1);
  expect(await calls(page, 'listen')).toEqual([]);
});

test('with Voice off a chat is not a target for the shortcut', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Write the release notes' }]);
  await installFakeVoice(page, { enabled: false });
  await openChat(page, 'Write the release notes');
  await emitVoice(page, { kind: 'press' });
  await page.waitForTimeout(300);
  expect(await calls(page, 'listen')).toEqual([]);
  expect(await calls(page, 'setPressTarget')).toEqual([]);
  await expect(page.getByRole('button', { name: 'Stop dictating' })).toHaveCount(0);
});
