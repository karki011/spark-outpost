import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';
import {
  NAME,
  POSTS_URL,
  TURN_TIMEOUT,
  asksLine,
  box,
  chip,
  inBothThemes,
  openOutpost,
  post,
  requestsTo,
  say,
  seeded,
  sendButton,
  stateOf,
  strip,
  thread,
} from './outposts-kit.ts';

const FILLER = Array.from({ length: 70 }, (_, index) => `detail${index}`).join(' ');
const STEPS = /^(Starting|Working|Reading your message|Writing a reply)$/;
const FAILED =
  "@api's turn failed: The fake provider failed on purpose because the message contains #fail.";
const LONG_HANDLE = 'customer-orders1';

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

const picker = (page: Page) => page.getByRole('listbox', { name: 'Chats in this outpost' });
const asked = (page: Page) => asksLine(page).locator('.op-ask');
const line = (message: Locator, handle: string) =>
  message.getByRole('article', { name: new RegExp(`^${handle}:`) });

function sentTo(requests: ReturnType<typeof requestsTo>): unknown[] {
  return requests.map((request) => (request.postDataJSON() as { to?: string[] }).to);
}

test('two chats are asked from the middle of one message and answer under it', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  const posted = requestsTo(page, POSTS_URL, 'POST');

  await box(page).pressSequentially('Could @');
  await expect(picker(page).getByRole('option')).toHaveText([/^@fe/, /^@api/]);
  await inBothThemes(page, 'picker', async () => {
    await expect(picker(page)).toBeVisible();
  });
  await box(page).press('ArrowDown');
  await expect(picker(page).getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await box(page).press('Enter');
  await expect(picker(page)).toBeHidden();
  await expect(box(page)).toHaveValue('Could @api ');
  await expect(thread(page).locator('.op-post')).toHaveCount(0);

  await box(page).pressSequentially('list the order fields so that @');
  await expect(picker(page)).toBeVisible();
  await box(page).press('Escape');
  await expect(picker(page)).toBeHidden();
  await box(page).pressSequentially('f');
  await expect(picker(page).getByRole('option')).toHaveText([/^@fe/]);
  await box(page).press('Enter');
  await box(page).pressSequentially(`can draw them? ${FILLER}`);

  await expect(asked(page)).toHaveText(['@api', '@fe']);
  await expect(sendButton(page)).toHaveText('Send request');
  await inBothThemes(page, 'asks', async () => {
    await expect(asksLine(page)).toBeVisible();
  });

  await box(page).press('Enter');
  const message = post(page, 'list the order fields so that @fe can draw them?');
  await expect(message).toHaveCount(1);
  await expect(message.locator('.op-post-head').first()).toContainText('Youto@api, @fe');
  expect(sentTo(posted)).toEqual([['api', 'fe']]);

  for (const handle of ['@api', '@fe']) {
    await expect(stateOf(line(message, handle))).toHaveText('Working', { timeout: TURN_TIMEOUT });
  }
  const doing = line(message, '@api').locator('.op-card-meta');
  await expect(doing).toHaveText(STEPS);
  await expect(doing).toHaveText('Writing a reply', { timeout: TURN_TIMEOUT });
  await expect(chip(page, 'api')).toContainText('Working');
  if (process.env.SPARK_REVIEW_SHOTS) {
    await inBothThemes(page, 'activity', async () => {
      await expect(message).toBeVisible();
    });
  }

  for (const handle of ['@api', '@fe']) {
    const own = line(message, handle);
    await expect(own.locator('.op-pill')).toHaveText('Idle', { timeout: TURN_TIMEOUT });
    await expect(own.locator('.op-card-meta')).toContainText(
      'This reply comes from the fake provider',
    );
  }
  await expect(thread(page).locator('.op-post')).toHaveCount(1);
  await expect(message.getByRole('button', { name: /^Cancel all/ })).toHaveCount(0);
  await inBothThemes(page, 'answers', async () => {
    await expect(message.locator('.op-card')).toHaveCount(2);
  });

  await openChats(page);
  await openOutpost(page);
  await expect(post(page, 'list the order fields').locator('.op-card')).toHaveCount(2);
});

test('a chat taken off the Asks line is only mentioned', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  const posted = requestsTo(page, POSTS_URL, 'POST');

  await box(page).fill('@fe draw what @api returns');
  await expect(asked(page)).toHaveText(['@fe', '@api']);
  const skip = asksLine(page).getByRole('button', { name: 'Do not ask @api' });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(asked(page)).toHaveText(['@fe']);
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue('@fe draw what @api returns');
  await expect(sendButton(page)).toHaveText('Send request');

  await page.keyboard.press('Enter');
  const request = post(page, 'draw what @api returns');
  await expect(request.locator('.op-post-head').first()).toContainText('Youto@fe');
  await expect(stateOf(request)).toHaveText('Idle', { timeout: TURN_TIMEOUT });
  expect(sentTo(posted)).toEqual([['fe']]);
  await expect(chip(page, 'api')).toContainText('Idle');
  await expect(thread(page).locator('.op-post')).toHaveCount(1);

  await box(page).fill('thanks @api');
  await asksLine(page).getByRole('button', { name: 'Do not ask @api' }).click();
  await expect(asksLine(page)).toHaveCount(0);
  await expect(sendButton(page)).toBeDisabled();
  await expect(page.locator('.op-hint')).toHaveText(
    'No recipients selected. Restore a recipient or choose Post note.',
  );
  await box(page).press('Enter');
  expect(sentTo(posted)).toEqual([['fe']]);
  await page.getByRole('button', { name: 'Message destination' }).click();
  await page.getByRole('menuitemradio', { name: /^Post note/ }).click();
  await box(page).press('Enter');
  await expect(post(page, 'thanks @api').locator('.op-kind')).toHaveText('note');
  expect(sentTo(posted)).toEqual([['fe'], []]);
  await expect(chip(page, 'api')).toContainText('Idle');
});

test('a failed request says why its turn failed', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);

  await say(page, 'could @api try the import again #fail');
  const request = post(page, 'try the import again');
  await expect(stateOf(request)).toHaveText('Failed', { timeout: TURN_TIMEOUT });
  await expect(request.locator('.op-card-meta')).toHaveText(FAILED);
  await expect(request.getByRole('button', { name: 'Open the thread with @api' })).toBeVisible();
  await inBothThemes(page, 'failed', async () => {
    await expect(request.locator('.op-card-meta')).toBeVisible();
  });
});

test('a long handle is read in full in the member stack and the header stays on screen', async ({
  page,
}) => {
  const [orders] = await seedChats([{ title: 'Customer orders' }]);
  if (!orders) throw new Error('The chat was not seeded.');
  await openChats(page);
  const created = await page.request.post('/api/outposts', {
    data: {
      id: randomUUID(),
      name: NAME,
      members: [{ conversationId: orders, handle: LONG_HANDLE }],
    },
  });
  expect(created.ok()).toBe(true);
  await openChats(page);
  const main = await openOutpost(page);
  await page.setViewportSize({ width: 600, height: 780 });

  const member = strip(page).getByRole('button', { name: new RegExp(`^@${LONG_HANDLE}, Idle`) });
  await expect(member).toHaveAttribute('title', new RegExp(`^@${LONG_HANDLE} · Idle`));
  const header = main.locator('.op-head');
  const fits = await header.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  expect(fits).toBe(true);
  await inBothThemes(page, 'long-handle', async () => {
    await expect(member).toBeVisible();
  });
});

test('a long message with no line breaks grows the box instead of scrolling inside it', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  const box = page.getByRole('combobox', { name: 'Message the outpost' });
  await box.fill(`Could @api list ${'the order fields and their types '.repeat(12)}`);
  const fit = await box.evaluate((area: HTMLTextAreaElement) => ({
    hidden: area.scrollHeight - area.clientHeight,
    scrolled: area.scrollTop,
  }));
  expect(fit.hidden).toBeLessThanOrEqual(1);
  expect(fit.scrolled).toBe(0);
});

test('explicit notes acknowledge saving and Ask all prepares a request without sending it', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = requestsTo(page, POSTS_URL, 'POST');
  await page.route(POSTS_URL, async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Message destination' }).click();
  await page.getByRole('menuitemradio', { name: /^Post note/ }).click();
  await box(page).fill('Where are we?');
  await expect(page.locator('.op-hint')).toHaveText('Note only · No agent will reply.');
  await sendButton(page).click();
  await expect(page.locator('.op-note-receipt').getByRole('status')).toContainText('Saving note…');
  release();
  await expect(page.locator('.op-note-receipt').getByRole('status')).toContainText(
    'Note saved · No agent was asked.',
  );
  await expect(chip(page, 'api')).toContainText('Idle');
  await expect(chip(page, 'fe')).toContainText('Idle');
  expect(sent).toHaveLength(1);
  await inBothThemes(page, 'note-receipt', async () => {
    await expect(page.getByRole('button', { name: 'Ask all', exact: true })).toBeVisible();
  });
  await page.getByRole('button', { name: 'Ask all', exact: true }).click();
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue('@all Where are we?');
  await expect(asksLine(page)).toContainText('@fe');
  await expect(asksLine(page)).toContainText('@api');
  expect(sent).toHaveLength(1);
  await sendButton(page).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.postDataJSON().to).toEqual(['fe', 'api']);
});

test('ordinary messages reach the displayed agent without adding a mention', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  const sent = requestsTo(page, POSTS_URL, 'POST');
  await box(page).fill('Where are we?');
  await expect(page.locator('.op-hint')).toContainText('To @fe');
  await inBothThemes(page, 'lead-message', async () => {
    await expect(sendButton(page)).toHaveText('Send message');
  });
  await sendButton(page).click();
  const request = post(page, 'Where are we?');
  await expect(stateOf(request)).toHaveText('Idle', { timeout: TURN_TIMEOUT });
  expect(sent[0]!.postDataJSON()).toMatchObject({
    text: 'Where are we?',
    toConversationId: expect.any(String),
  });
  expect(sent[0]!.postDataJSON().to).toBeUndefined();
  await expect(request).toContainText('@fe');
  await expect(chip(page, 'api')).toContainText('Idle');
  await page.getByRole('button', { name: 'Message destination' }).click();
  await page.getByRole('menuitemradio', { name: '@api', exact: true }).click();
  await say(page, 'What is next?');
  await expect(stateOf(post(page, 'What is next?'))).toHaveText('Idle', { timeout: TURN_TIMEOUT });
  expect(sent[1]!.postDataJSON().toConversationId).not.toBe(
    sent[0]!.postDataJSON().toConversationId,
  );
});

test('retry keeps the original recipient and preserves a newer draft and destination', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  const sent = requestsTo(page, POSTS_URL, 'POST');
  await page.route(POSTS_URL, async (route) => {
    if (route.request().method() !== 'POST' || ++attempts > 1) return route.continue();
    await held;
    return route.fulfill({ status: 400, json: { error: 'Could not send. Try again.' } });
  });
  await box(page).fill('Summarize the frontend changes');
  await sendButton(page).click();
  await expect.poll(() => sent.length).toBe(1);
  await box(page).fill('New API draft');
  await page.getByRole('button', { name: 'Message destination' }).click();
  await page.getByRole('menuitemradio', { name: '@api', exact: true }).click();
  release();
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.locator('.op-note-receipt')).toContainText(
    'Unsent to @fe: Summarize the frontend changes',
  );
  await expect(sendButton(page)).toBeDisabled();
  await inBothThemes(page, 'retry-original-message', async () => {
    await expect(retry).toBeVisible();
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
  await retry.click();
  await expect(retry).toBeHidden();
  expect(sent[1]!.postDataJSON()).toMatchObject({
    text: 'Summarize the frontend changes',
    toConversationId: sent[0]!.postDataJSON().toConversationId,
  });
  await expect(box(page)).toHaveValue('New API draft');
  await expect(page.locator('.op-hint')).toContainText('To @api');
  await sendButton(page).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]!.postDataJSON()).toMatchObject({ text: 'New API draft' });
  expect(sent[2]!.postDataJSON().toConversationId).not.toBe(
    sent[0]!.postDataJSON().toConversationId,
  );
});
