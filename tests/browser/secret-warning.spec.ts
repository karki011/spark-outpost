import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const KEY = 'sk-ant-api03-FAKEfake0123456789abcdEFGH';
const MESSAGE = `Why does auth fail? My key is ${KEY}`;
const CLEANED = 'Why does auth fail? My key is [removed]';

async function userMessages(): Promise<string[]> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ content: string }>(
      `SELECT content FROM messages WHERE role = 'user' ORDER BY created_at`,
    );
    return rows.map((row) => row.content);
  } finally {
    await db.end();
  }
}

const warning = (page: Page) => page.getByRole('alert').filter({ hasText: 'This looks like' });

async function expectWarning(page: Page) {
  await expect(warning(page)).toContainText('This looks like an API key.');
  await expect(warning(page)).toContainText('Paste API keys in Settings → AI providers instead.');
  await expect(warning(page).getByRole('button', { name: 'Remove it' })).toBeFocused();
}

async function newChatInput(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  return page.getByRole('textbox', { name: 'Message' });
}

test('a chat message with a key waits, and Remove it swaps the key for [removed]', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const input = await newChatInput(page);
  await input.fill(MESSAGE);
  await input.press('Enter');
  await expectWarning(page);
  expect(await userMessages()).toEqual([]);

  await page.keyboard.press('Enter');
  await expect(warning(page)).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(CLEANED);

  await input.press('Enter');
  await expect(page.locator('.md', { hasText: `You wrote: "${CLEANED}"` })).toBeVisible({
    timeout: 15_000,
  });
  expect(await userMessages()).toEqual([CLEANED]);
});

test('Send anyway sends the message as written, and Escape goes back to editing', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const input = await newChatInput(page);
  await input.fill(`export GITHUB_TOKEN=ghp_FAKEfake0123456789abcdefABCDEF`);
  await input.press('Enter');
  await expect(warning(page)).toContainText('This looks like a GitHub token.');
  await page.keyboard.press('Escape');
  await expect(warning(page)).toHaveCount(0);
  await expect(input).toBeFocused();

  await input.fill(MESSAGE);
  await input.press('Enter');
  await expectWarning(page);
  await warning(page).getByRole('button', { name: 'Send anyway' }).click();
  await expect(warning(page)).toHaveCount(0);
  await expect.poll(userMessages).toEqual([MESSAGE]);
});

test('ordinary code and prose send without a warning', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const input = await newChatInput(page);
  const code = 'const apiKey = process.env.OPENAI_API_KEY; // see the sk-learn-pipeline-for-images';
  await input.fill(code);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await input.press('Enter');
  await expect(page.locator('.md', { hasText: 'You wrote:' })).toBeVisible({ timeout: 15_000 });
  await expect(warning(page)).toHaveCount(0);
});

test('Home warns before starting a chat with a key in it', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  const input = page
    .getByRole('region', { name: 'Start a new chat' })
    .getByRole('textbox', { name: 'Message' });
  await input.fill(MESSAGE);
  await input.press('Enter');
  await expectWarning(page);
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue(CLEANED);
  expect(await userMessages()).toEqual([]);
});

test('the island Quick chat and Ask warn before sending a key', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  const island = page.getByRole('region', { name: 'Spark Island' });
  await expect(island).toBeVisible();

  await page.keyboard.press('Alt+Space');
  const message = island.getByRole('textbox', { name: 'Message' });
  await expect(message).toBeFocused();
  await message.fill(MESSAGE);
  await page.keyboard.press('Enter');
  await expectWarning(page);
  await page.keyboard.press('Enter');
  await expect(message).toHaveValue(CLEANED);
  await expect(message).toBeFocused();

  await page.keyboard.press('Meta+3');
  const ask = island.getByRole('textbox', { name: 'Ask Spark' });
  await expect(ask).toBeFocused();
  await ask.fill(`Is ${KEY} still valid?`);
  await page.keyboard.press('Enter');
  await expectWarning(page);
  await page.keyboard.press('Enter');
  await expect(ask).toHaveValue('Is [removed] still valid?');
  expect(await userMessages()).toEqual([]);
});
