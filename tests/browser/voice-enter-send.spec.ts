import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { emitVoice, installFakeVoice, voiceCalls } from './fake-voice.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

async function userMessageTexts(): Promise<string[]> {
  const db = openTestDb();
  try {
    const result = await db.query(
      `SELECT content FROM messages WHERE role = 'user' ORDER BY created_at`,
    );
    return result.rows.map((row) => row.content as string);
  } finally {
    await db.end();
  }
}

async function startDictating(page: Page) {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Write the release notes' }]);
  await installFakeVoice(page);
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByText('Write the release notes')
    .click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Check this branch.');
  await page.getByRole('button', { name: 'Dictate' }).click();
  await expect(page.getByRole('button', { name: 'Stop dictating' })).toBeVisible();
  await emitVoice(page, { kind: 'partial', id: 'listen-1', text: 'and the login' });
  await expect(input).toHaveValue('Check this branch. and the login');
  return input;
}

test('Enter while dictating stops listening and sends the draft with the final words', async ({
  page,
}) => {
  const input = await startDictating(page);
  const before = await userMessageTexts();
  await input.press('Enter');
  await expect.poll(async () => (await voiceCalls(page)).map((call) => call.op)).toContain('stop');
  expect(await userMessageTexts()).toEqual(before);
  await emitVoice(page, {
    kind: 'final',
    id: 'listen-1',
    text: 'and the login redirect.',
    reason: 'stopped',
  });
  await expect
    .poll(userMessageTexts)
    .toEqual([...before, 'Check this branch. and the login redirect.']);
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Dictate' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('the Send button works while dictating, and Esc before the words arrive sends nothing', async ({
  page,
}) => {
  const input = await startDictating(page);
  const before = await userMessageTexts();
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(async () => (await voiceCalls(page)).map((call) => call.op)).toContain('stop');
  await page.keyboard.press('Escape');
  await emitVoice(page, { kind: 'final', id: 'listen-1', text: 'too late', reason: 'stopped' });
  await expect(input).toHaveValue('Check this branch.');
  expect(await userMessageTexts()).toEqual(before);
});
