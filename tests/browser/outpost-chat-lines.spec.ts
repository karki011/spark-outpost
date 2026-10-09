import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { ConversationDetail, OutpostDetail } from '../../packages/contracts/src/index.ts';
import { resetTestDatabase } from './database.ts';
import {
  NAME,
  TURN_TIMEOUT,
  openOutpost,
  outpostPage,
  post,
  say,
  seeded,
  stateOf,
} from './outposts-kit.ts';

const SHOTS = process.env.SPARK_REVIEW_SHOTS;
const ASK = 'List the order fields';
const SENT = 'Which page shows the order total?';
const THEMES = [
  ['light', 'light'],
  ['dark', 'graphite'],
] as const;

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

async function inBothThemes(page: Page, name: string, check: () => Promise<void>): Promise<void> {
  const root = page.locator('html');
  const before = await root.getAttribute('data-skin');
  for (const [scheme, skin] of THEMES) {
    await root.evaluate((html, value) => (html.dataset.skin = value), skin);
    await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-${name}-${scheme}.png` });
    await check();
    const results = await new AxeBuilder({ page })
      .include('section[data-turn]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  }
  await root.evaluate((html, value) => {
    if (value === null) delete html.dataset.skin;
    else html.dataset.skin = value;
  }, before);
}

async function asRequestFromChat(page: Page, outpostId: string): Promise<void> {
  const fetched = await page.request.get(`/api/outposts/${outpostId}`);
  const detail = (await fetched.json()) as OutpostDetail;
  const asked = detail.posts.find((candidate) => candidate.body === ASK);
  const [frontend, api] = detail.outpost.members;
  if (!asked || !frontend || !api) throw new Error('The outpost was not seeded.');
  const chat = await page.request.get(`/api/conversations/${api.conversationId}`);
  const turn = ((await chat.json()) as ConversationDetail).runs.find((run) => run.outpost);
  if (!turn?.startedAt) throw new Error('The request started no turn.');
  const sent = {
    ...asked,
    id: randomUUID(),
    body: `${SENT}\nI need it for the fields list.`,
    fromUser: false,
    fromConversationId: api.conversationId,
    fromHandle: api.handle,
    toConversationId: frontend.conversationId,
    toHandle: frontend.handle,
    createdAt: turn.startedAt,
    runId: null,
    taskId: null,
    answer: null,
    state: 'working',
  };
  await page.route(`**/api/outposts/${outpostId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as OutpostDetail;
    await route.fulfill({ response, json: { ...body, posts: [...body.posts, sent] } });
  });
  await page.route(`**/api/conversations/${api.conversationId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as ConversationDetail;
    const runs = body.runs.map((run) =>
      run.outpost
        ? { ...run, outpost: { ...run.outpost, fromUser: false, fromHandle: frontend.handle } }
        : run,
    );
    await route.fulfill({ response, json: { ...body, runs } });
  });
}

test('a member chat says a request is not from the user and lists the request it sent', async ({
  page,
}) => {
  const outpostId = await seeded(page);
  await openOutpost(page);
  await say(page, `@api ${ASK}`);
  await expect(stateOf(post(page, ASK))).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  await asRequestFromChat(page, outpostId);
  await page.reload();
  await openOutpost(page);
  await post(page, ASK).getByRole('button', { name: 'Open @api in chat' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Orders API');

  const header = page.locator('.bubble.from', { hasText: ASK });
  const line = page.locator('section[data-turn] .op-line');
  await inBothThemes(page, 'sent', async () => {
    await expect(header.locator('.from-head b')).toHaveText('From @fe');
    await expect(header.locator('.from-note')).toHaveText('not from you');
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(`To @fe${SENT}`);
    await expect(line).not.toContainText('I need it for the fields list.');
    await expect(line.locator('.op-line-state')).toHaveText('Working');
  });

  const open = line.getByRole('button', { name: 'Open the request to @fe in the outpost' });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(outpostPage(page, NAME)).toBeVisible();
  await expect(post(page, SENT)).toBeInViewport();
});
