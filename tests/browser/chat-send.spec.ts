import { expect, test, type Page, type Request } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SEND_URL = /\/api\/conversations\/[^/]+\/messages$/;

test.beforeEach(async () => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
});

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  return input;
}

function sentIds(page: Page): string[] {
  const ids: string[] = [];
  page.on('request', (request: Request) => {
    if (request.method() === 'POST' && SEND_URL.test(request.url())) {
      ids.push((request.postDataJSON() as { id: string }).id);
    }
  });
  return ids;
}

test('shows the message as starting at once and offers Retry while the server is slow', async ({
  page,
}) => {
  const marker = `Slow send ${Date.now()}`;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(SEND_URL, async (route) => {
    await held;
    await route.continue();
  });
  const ids = sentIds(page);
  const input = await newChat(page);

  await input.fill(marker);
  await input.press('Enter');
  await input.press('Enter');

  const pending = page.locator('.msg.me', { hasText: marker });
  await expect(pending.getByRole('status')).toHaveText('Starting…', { timeout: 1_000 });
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();

  const slow = pending.getByRole('alert');
  await expect(slow).toContainText('Spark hasn’t accepted this message yet.', { timeout: 8_000 });
  await slow.getByRole('button', { name: 'Retry' }).click();
  await expect(pending.getByRole('status')).toHaveText('Starting…');

  release();
  await expect(page.locator('.md', { hasText: `You wrote: "${marker}"` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.bubble', { hasText: marker })).toHaveCount(1);
  await expect(page.locator('.send-status')).toHaveCount(0);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(1);
});

test('keeps a failed message with Retry and resends it with the same key', async ({ page }) => {
  const marker = `Failed send ${Date.now()}`;
  let failures = 1;
  await page.route(SEND_URL, async (route) => {
    if (failures-- > 0) {
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  const ids = sentIds(page);
  const input = await newChat(page);

  await input.fill(marker);
  await input.press('Enter');

  const failed = page.locator('.msg.me', { hasText: marker }).getByRole('alert');
  await expect(failed).toContainText('Not sent.');
  await expect(input).toHaveValue('');
  await failed.getByRole('button', { name: 'Retry' }).click();

  await expect(page.locator('.md', { hasText: `You wrote: "${marker}"` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.bubble', { hasText: marker })).toHaveCount(1);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(1);
});

test('Edit puts a failed message back in the composer', async ({ page }) => {
  const marker = `Edit send ${Date.now()}`;
  await page.route(SEND_URL, (route) =>
    route.fulfill({ status: 500, json: { error: 'The server hit an unexpected error.' } }),
  );
  const input = await newChat(page);

  await input.fill(marker);
  await input.press('Enter');

  const failed = page.locator('.msg.me', { hasText: marker }).getByRole('alert');
  await expect(failed).toContainText('Not sent. The server hit an unexpected error.');
  await failed.getByRole('button', { name: 'Edit' }).click();

  await expect(input).toHaveValue(marker);
  await expect(page.locator('.msg.me', { hasText: marker })).toHaveCount(0);
});

test('sends a 200,000-character paste whole and keeps the composer usable', async ({ page }) => {
  const marker = `Long send ${Date.now()}`;
  const line = 'The quick brown fox jumps over the lazy dog.\n';
  const long = `${marker}\n${line.repeat(5_000)}`.slice(0, 199_999) + '!';
  const bodies: string[] = [];
  page.on('request', (request: Request) => {
    if (request.method() === 'POST' && SEND_URL.test(request.url())) {
      bodies.push((request.postDataJSON() as { content: string }).content);
    }
  });
  const input = await newChat(page);

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), long);
  await input.press('ControlOrMeta+V');
  await expect
    .poll(() => input.evaluate((node: HTMLTextAreaElement) => node.value.length))
    .toBe(200_000);
  expect(await input.evaluate((node) => node.clientHeight)).toBeLessThan(240);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await input.press('Enter');

  const bubble = page.locator('.msg.me .bubble', { hasText: marker });
  await expect(bubble).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.send-status')).toHaveCount(0, { timeout: 15_000 });
  await expect(input).toHaveValue('');
  expect(bodies).toEqual([long]);
  expect(await bubble.evaluate((node) => node.textContent?.length)).toBe(200_000);
});

test('a message the server finds too large says so and Edit gives the text back', async ({
  page,
}) => {
  const marker = `Too large ${Date.now()}`;
  const reason =
    'This message is over 16 MB, more than Spark can receive in one request. Shorten it and send again.';
  await page.route(SEND_URL, (route) => route.fulfill({ status: 413, json: { error: reason } }));
  const input = await newChat(page);

  await input.fill(marker);
  await input.press('Enter');

  const failed = page.locator('.msg.me', { hasText: marker }).getByRole('alert');
  await expect(failed).toContainText(`Not sent. ${reason}`);
  await failed.getByRole('button', { name: 'Edit' }).click();

  await expect(input).toHaveValue(marker);
});

test('Stop shows Stopping… at once and the chat settles as stopped @packaged', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/runs\/[^/]+\/cancel$/, async (route) => {
    await held;
    await route.continue();
  });
  const input = await newChat(page);

  await input.fill(`Stop me ${Date.now()}`);
  await input.press('Enter');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Stopping…' })).toBeVisible({ timeout: 1_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Stopping…' })).toBeVisible();

  release();
  await expect(page.getByText('Stopped before finishing.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});
