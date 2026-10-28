import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { TEST_DATA_DIR } from './stub-config.ts';

const chatHome = (chatId: string) => path.join(TEST_DATA_DIR, 'spark', 'chats', chatId);

test.beforeEach(async () => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
});

test('a chat with no project shows the files its agent made with the turn @packaged', async ({
  page,
}) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(
    page.locator('.comp-bar').getByRole('button', { name: 'Choose project' }),
  ).toBeVisible();

  await input.fill('Make me a CSV and a chart #files');
  await input.press('Enter');

  await expect(page.locator('.md', { hasText: 'files=done own-folder' })).toBeVisible({
    timeout: 20_000,
  });
  const files = page.getByRole('group', { name: 'Files from this turn' });
  const csv = files.getByRole('link', { name: 'cpi.csv 40 B' });
  await expect(csv).toBeVisible();
  await expect(page.getByText('No pull request')).toHaveCount(0);
  await expect(page.locator('.fchg')).toHaveCount(0);

  const href = await csv.getAttribute('href');
  const opened = await page.request.get(href!);
  expect(opened.headers()['content-type']).toBe('text/plain; charset=utf-8');
  expect(await opened.text()).toContain('month,index');

  const download = page.waitForEvent('download');
  await files.getByRole('link', { name: 'Download cpi.csv' }).click();
  expect((await download).suggestedFilename()).toBe('cpi.csv');

  await expect(files.getByRole('link', { name: 'Download chart.png' })).toHaveAttribute(
    'download',
    'chart.png',
  );
  await files.getByRole('button', { name: /^View chart\.png, \d+ B$/ }).click();
  const viewer = page.getByRole('dialog', { name: 'chart.png' });
  await expect(viewer.getByRole('img', { name: 'chart.png' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toHaveCount(0);

  const chats = (await (await page.request.get('/api/conversations')).json()) as { id: string }[];
  expect(chats).toHaveLength(1);
  const chatId = chats[0]!.id;
  const home = chatHome(chatId);
  expect(existsSync(path.join(home, 'work', 'cpi.csv'))).toBe(true);
  expect((await page.request.delete(`/api/conversations/${chatId}`, { data: {} })).status()).toBe(
    204,
  );
  expect(existsSync(home)).toBe(false);
});
