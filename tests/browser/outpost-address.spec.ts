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
  message.getByRole('listitem', { name: handle, exact: true });

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
  await expect(message.locator('.op-post-head').first()).toContainText('Youto@api@fe');
  expect(sentTo(posted)).toEqual([['api', 'fe']]);

  for (const handle of ['@api', '@fe']) {
    await expect(stateOf(line(message, handle))).toHaveText('Working', { timeout: TURN_TIMEOUT });
  }
  const doing = line(message, '@api').locator('.op-activity');
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
    await expect(stateOf(own)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
    await expect(own.locator('.op-reply')).toContainText('This reply comes from the fake provider');
    await expect(own.locator('.op-reply .op-post-head')).toHaveCount(0);
    await expect(own.locator('.op-activity')).toHaveCount(0);
  }
  await expect(thread(page).locator('.op-post')).toHaveCount(1);
  await expect(message.getByRole('button', { name: 'Cancel all' })).toHaveCount(0);
  await inBothThemes(page, 'answers', async () => {
    await expect(message.locator('.op-reply')).toHaveCount(2);
  });

  await openChats(page);
  await openOutpost(page);
  await expect(post(page, 'list the order fields').locator('.op-reply')).toHaveCount(2);
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
  await expect(stateOf(request)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  expect(sentTo(posted)).toEqual([['fe']]);
  await expect(chip(page, 'api')).toContainText('Idle');
  await expect(thread(page).locator('.op-post')).toHaveCount(1);

  await box(page).fill('thanks @api');
  await asksLine(page).getByRole('button', { name: 'Do not ask @api' }).click();
  await expect(asksLine(page)).toHaveCount(0);
  await expect(sendButton(page)).toHaveText('Post note');
  await expect(page.locator('.op-hint')).toHaveText('Asks nobody. This posts as a note.');
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
  await expect(request.locator('.op-reason.bad')).toHaveText(FAILED);
  await expect(request.getByRole('button', { name: 'Open @api in chat' })).toBeVisible();
  await inBothThemes(page, 'failed', async () => {
    await expect(request.locator('.op-reason.bad')).toBeVisible();
  });
});

test('a long handle wraps in the member strip instead of being cut', async ({ page }) => {
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
  await openOutpost(page);
  await page.setViewportSize({ width: 600, height: 780 });

  const member = strip(page).getByRole('button', { name: new RegExp(`^@${LONG_HANDLE}`) });
  const handle = member.locator('.op-member-top b');
  await expect(handle).toHaveText(`@${LONG_HANDLE}`);
  await expect(handle).toHaveCSS('text-overflow', 'clip');
  await expect(handle).toHaveCSS('white-space', 'normal');
  const fits = await handle.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  expect(fits).toBe(true);
  const inside = await member.evaluate((button) => {
    const outer = button.getBoundingClientRect();
    const state = button.querySelector('.op-member-state')?.getBoundingClientRect();
    return state !== undefined && state.right <= outer.right + 1 && state.left >= outer.left;
  });
  expect(inside).toBe(true);
  await inBothThemes(page, 'long-handle', async () => {
    await expect(handle).toBeVisible();
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
