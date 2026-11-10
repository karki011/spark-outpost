import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  LONG_ASK,
  POSTS_URL,
  TURN_TIMEOUT,
  cancelRequest,
  openOutpost,
  post,
  requestsTo,
  say,
  seeded,
  stateOf,
} from './outposts-kit.ts';

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('a cancelled request can be sent again as a new request with the same words', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, `@api Summarise ${LONG_ASK}`);
  const request = post(page, 'Summarise');
  await expect(stateOf(request)).toHaveText('Working', { timeout: TURN_TIMEOUT });
  await cancelRequest(request, 'api');
  await expect(stateOf(request)).toHaveText('Cancelled', { timeout: TURN_TIMEOUT });

  const posts = requestsTo(page, POSTS_URL, 'POST');
  await request.getByRole('button', { name: 'Retry the request to @api' }).click();

  await expect.poll(() => posts.length).toBe(1);
  const sent = JSON.parse(posts[0]?.postData() ?? '{}') as { text?: string };
  expect(sent.text).toContain('Summarise');
  expect(sent.text).toContain('word219');
  await expect(page.locator('.op-card')).toHaveCount(2);
});
