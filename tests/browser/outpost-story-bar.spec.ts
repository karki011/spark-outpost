import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { saveDraft } from '../../apps/server/src/persistence/outpost-drafts.ts';
import type { OutpostDetail } from '../../packages/contracts/src/outposts.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  LONG_ASK,
  NAME,
  POSTS_URL,
  TURN_TIMEOUT,
  box,
  openOutpost,
  post,
  requestsTo,
  stateOf,
} from './outposts-kit.ts';
import { expectNoSidewaysScroll, PHONE, shot } from './responsive-kit.ts';
import { seedChats } from './sidebar-seed.ts';

const START_NOW_URL = /\/api\/outposts\/[^/]+\/posts\/[^/]+\/start-now$/;
const API_TASK = `Summarise ${LONG_ASK}`;
const FE_TASK = 'Call the usage endpoint from the page.';
const API_BRANCH = 'spark/usage-endpoint';

let base: string;

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
  base = mkdtempSync(path.join(tmpdir(), 'spark-outpost-story-'));
});

test.afterEach(() => rmSync(base, { recursive: true, force: true }));

interface Story {
  outpostId: string;
  api: string;
  fe: string;
}

async function proposeDraft(leadChatId: string, projectId: string): Promise<string> {
  const db = openTestDb();
  try {
    const id = randomUUID();
    await saveDraft(db, {
      id,
      workspaceId: await ensureLocalWorkspace(db),
      conversationId: leadChatId,
      runId: null,
      outpostId: null,
      body: {
        title: 'Usage by user',
        chats: [
          { handle: 'api', title: 'Usage endpoint', projectId, task: API_TASK },
          { handle: 'fe', title: 'Usage page', projectId, task: FE_TASK, dependsOn: 'api' },
        ],
      },
    });
    return id;
  } finally {
    await db.end();
  }
}

function subTask(projectId: string, handle: string, text: string, dependsOn?: string) {
  const conversationId = randomUUID();
  return {
    new: {
      conversationId,
      projectId,
      provider: 'claude',
      model: null,
      agentMode: 'acceptEdits',
      level: 'hands-off',
    },
    handle,
    firstMessage: { id: randomUUID(), text, attachmentIds: [] },
    ...(dependsOn ? { dependsOn } : {}),
  };
}

async function startStory(page: Page): Promise<Story> {
  await openChats(page);
  const folder = path.join(base, 'shop');
  mkdirSync(folder);
  const created = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string };
  const [lead] = await seedChats([{ title: 'Checkout plan', projectIds: [project.id] }]);
  if (!lead) throw new Error('The lead chat was not seeded.');
  const draftId = await proposeDraft(lead, project.id);
  const api = subTask(project.id, 'api', API_TASK);
  const fe = subTask(project.id, 'fe', FE_TASK, api.new.conversationId);
  const outpostId = randomUUID();
  const started = await page.request.post('/api/outposts', {
    data: {
      id: outpostId,
      name: NAME,
      draftId,
      members: [{ conversationId: lead, handle: 'lead' }, api, fe],
    },
  });
  expect(started.ok()).toBe(true);
  expect(((await started.json()) as { failed: unknown[] }).failed).toEqual([]);
  await openChats(page);
  return { outpostId, api: api.new.conversationId, fe: fe.new.conversationId };
}

async function withPullRequests(page: Page, story: Story): Promise<void> {
  await page.route(`**/api/outposts/${story.outpostId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const detail = (await response.json()) as OutpostDetail;
    for (const task of detail.stories.flatMap((found) => found.tasks)) {
      const parent = task.conversationId === story.api;
      task.branch = parent ? API_BRANCH : 'spark/usage-page';
      task.pullRequest = {
        number: parent ? 123 : 124,
        url: `https://github.com/acme/shop/pull/${parent ? 123 : 124}`,
        state: 'open',
        draft: !parent,
        base: parent ? 'main' : API_BRANCH,
      };
      task.warnings = parent
        ? []
        : [
            { kind: 'behind_parent', text: '@api has commits that @fe does not have' },
            { kind: 'parent_not_pushed', text: "@api's branch is not pushed, so @fe cannot push" },
          ];
    }
    await route.fulfill({ response, json: detail });
  });
}

const stories = (page: Page) => page.getByRole('region', { name: 'Stories' });
const subTasks = (page: Page) => page.getByRole('list', { name: 'Sub-tasks of Usage by user' });

async function expectAccessible(page: Page): Promise<void> {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const results = await new AxeBuilder({ page })
      .include('.main.op')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await shot(page, `outpost-r2-story-${colorScheme}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('a sub-task waits for the one it starts after until Start anyway', async ({ page }) => {
  await startStory(page);
  await openOutpost(page);
  const held = post(page, FE_TASK);
  await expect(held.locator('.op-post-head').first()).toContainText('@leadnot from you');
  await expect(held.locator('.op-post-head .chat-face')).toHaveCount(2);
  await expect(held.locator('.op-reason')).toHaveText('Waiting for @api');
  await expect(stateOf(held)).toHaveText('Sent');
  await expect(stateOf(post(page, 'Summarise'))).toHaveText('Working', { timeout: TURN_TIMEOUT });

  const summary = stories(page).locator('summary');
  await expect(summary).toContainText('Usage by user');
  await expect(summary).toContainText('0 of 2 answered');
  await expect(subTasks(page)).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  const rows = subTasks(page).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('@api');
  await expect(rows.nth(1)).toContainText('@fe');
  await expect(rows.nth(1)).toContainText('on @api');
  await expect(rows.nth(1)).toContainText('Waiting for @api');
  await expectAccessible(page);

  const starts = requestsTo(page, START_NOW_URL, 'POST');
  const startAnyway = held.getByRole('button', { name: 'Start the request to @fe anyway' });
  await startAnyway.focus();
  await page.keyboard.press('Enter');
  await expect(startAnyway).toHaveCount(0);
  await expect(held.locator('.op-reason')).toHaveCount(0, { timeout: TURN_TIMEOUT });
  await expect(stateOf(held)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  expect(starts).toHaveLength(1);
  await expect(rows.nth(1)).toContainText('Answered');
  await expect(summary).toContainText(/[12] of 2 answered/);
});

test('the story bar shows stacked pull requests and hands a stack update to the message box', async ({
  page,
}) => {
  const story = await startStory(page);
  await withPullRequests(page, story);
  await openOutpost(page);
  const summary = stories(page).locator('summary');
  await expect(summary).toContainText('2 PRs · 2 warnings');
  await summary.click();

  const parent = stories(page).getByRole('link', { name: 'Pull request #123 into main, open' });
  await expect(parent).toHaveAttribute('href', 'https://github.com/acme/shop/pull/123');
  const child = stories(page).getByRole('link', { name: 'Pull request #124 into #123, draft' });
  await expect(child).toContainText('#124 → #123');
  await expect(subTasks(page)).toContainText('@api has commits that @fe does not have');
  await expect(subTasks(page)).toContainText("@api's branch is not pushed, so @fe cannot push");
  await expectAccessible(page);

  const sent = requestsTo(page, POSTS_URL, 'POST');
  await stories(page).getByRole('button', { name: 'Open @fe in chat' }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const update = stories(page).getByRole('button', { name: 'Update from @api' });
  await expect(update).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue(
    `@fe merge ${API_BRANCH} into your branch, fix any conflicts and run the checks.`,
  );
  await expect(page.locator('.op-send')).toHaveText('Send request');
  expect(sent).toHaveLength(0);

  await page.setViewportSize(PHONE);
  await expect(subTasks(page)).toBeVisible();
  await expectNoSidewaysScroll(page);
  await shot(page, 'outpost-r2-story-phone');
});
