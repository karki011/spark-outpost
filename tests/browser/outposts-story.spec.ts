import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { send } from './project-chat-kit.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  NAME,
  TURN_TIMEOUT,
  outpostPage,
  post,
  proceed,
  requestsTo,
  sheet,
  sidebar,
  startButton,
  stateOf,
  stepNow,
  thread,
} from './outposts-kit.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.SPARK_REVIEW_SHOTS;
const START_NOW_URL = /\/api\/outposts\/[^/]+\/posts\/[^/]+\/start-now$/;
const STORY = 'Usage by user';
const API_TASK = 'Add GET /usage.';
const FE_TASK = 'Build the usage page.';
const DOCS_TASK = 'Describe the usage page.';
const THEMES = [
  ['light', 'light'],
  ['dark', 'graphite'],
] as const;

let base: string;

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  base = mkdtempSync(path.join(tmpdir(), 'sos-'));
});

test.afterEach(() => rmSync(base, { recursive: true, force: true }));

const gate = (name: string) => path.join(path.basename(base), name);
const finish = (name: string) => writeFileSync(path.join(base, name), '');

function task(summary: string, name: string, reply: string): string {
  const script = JSON.stringify([{ waitFor: gate(name) }, { say: reply }]);
  return `${summary}\n\n\n#build #sparkscript ${script}`;
}

function proposal(): string {
  const chats = [
    {
      handle: 'api',
      title: 'Usage endpoint',
      project: 'shop',
      task: task(API_TASK, 'api', 'The endpoint is in.'),
    },
    {
      handle: 'fe',
      title: 'Usage page',
      project: 'shop',
      dependsOn: 'api',
      task: task(FE_TASK, 'fe', 'The page is in.'),
    },
    {
      handle: 'docs',
      title: 'Usage docs',
      project: 'shop',
      dependsOn: 'fe',
      task: task(DOCS_TASK, 'docs', 'The docs are in.'),
    },
  ];
  const steps = [
    { tool: 'spark_outpost_draft', args: { title: STORY, name: NAME, chats } },
    { say: 'Three chats are proposed for this story.' },
  ];
  return `#build #sparkscript ${JSON.stringify(steps)}`;
}

async function leadInPlanMode(page: Page): Promise<void> {
  await openChats(page);
  const folder = path.join(base, 'shop');
  mkdirSync(folder);
  const created = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(created.ok()).toBe(true);
  const { id: projectId } = (await created.json()) as { id: string };
  const [lead] = await seedChats([{ title: 'Checkout plan', projectIds: [projectId] }]);
  if (!lead) throw new Error('The lead chat was not seeded.');
  const moded = await page.request.patch(`/api/conversations/${lead}/settings`, {
    data: { agentMode: 'plan' },
  });
  expect(moded.ok()).toBe(true);
  await openChats(page);
  await sidebar(page).getByText('Checkout plan').click();
  await expect(page.locator('.chat-title')).toHaveText('Checkout plan');
}

async function inBothThemes(page: Page, name: string, area: string): Promise<void> {
  const root = page.locator('html');
  const before = await root.getAttribute('data-skin');
  for (const [scheme, skin] of THEMES) {
    await root.evaluate((html, value) => (html.dataset.skin = value), skin);
    await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-${name}-${scheme}.png` });
    const results = await new AxeBuilder({ page })
      .include(area)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  }
  await root.evaluate((html, value) => {
    if (value === null) delete html.dataset.skin;
    else html.dataset.skin = value;
  }, before);
}

const newChatRows = (dialog: Locator) =>
  dialog.getByRole('listitem').filter({ hasText: /Usage (endpoint|page|docs)/ });

async function reviewAndStart(page: Page): Promise<void> {
  const line = page.locator('section[data-turn] .op-line');
  await expect(line).toContainText('Proposed 3 chats · 2 stacked', { timeout: TURN_TIMEOUT });
  await inBothThemes(page, '1-draft-line', 'section[data-turn]');
  await line.getByRole('button', { name: 'Review and start' }).focus();
  await page.keyboard.press('Enter');

  const dialog = sheet(page, 'New outpost');
  const name = dialog.getByRole('textbox', { name: /^Name/ });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue(NAME);
  await inBothThemes(page, '2-sheet-name', '[role="dialog"]');
  await page.keyboard.press('Enter');
  await expect(stepNow(dialog)).toContainText('Chats');

  await dialog.getByRole('textbox', { name: 'Handle for Checkout plan' }).fill('lead');
  await expect(newChatRows(dialog)).toHaveCount(3);
  for (const row of await newChatRows(dialog).all()) await expect(row).toContainText('· Plan');
  await expect(newChatRows(dialog).nth(1)).toContainText('Starts after @api');
  await expect(newChatRows(dialog).nth(2)).toContainText('Starts after @fe');

  await dialog.getByRole('button', { name: 'Edit Usage endpoint' }).click();
  await expect(dialog.getByText('No pull request in a read-only mode')).toBeVisible();
  await dialog.getByRole('button', { name: 'Permissions: Plan' }).click();
  await page
    .getByRole('radiogroup', { name: 'Agent mode' })
    .getByRole('radio', { name: /^Accept edits/ })
    .click();
  await expect(dialog.getByRole('button', { name: 'Permissions: Accept edits' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Pull request', exact: true })).toContainText(
    'Pull request, parallel',
  );
  await inBothThemes(page, '3-sheet-chat', '[role="dialog"]');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(newChatRows(dialog).first()).toContainText('· Accept edits');

  await proceed(dialog).click();
  await expect(stepNow(dialog)).toContainText('Review');
  await expect(dialog).toContainText("First messages are sent as @lead's, not yours.");
  await expect(dialog).toContainText('Starts after @api · stacked on its branch');
  await expect(dialog).toContainText('Starts right away · Pull request, parallel');
  await inBothThemes(page, '4-sheet-review', '[role="dialog"]');
  await startButton(dialog).click();
  await expect(outpostPage(page, NAME)).toBeVisible({ timeout: TURN_TIMEOUT });
}

test('a chat proposes sub-chats, the user starts them, held ones follow, and the lead gets one wrap-up', async ({
  page,
}) => {
  await leadInPlanMode(page);
  await send(page, proposal());
  await reviewAndStart(page);

  const [api, fe, docs] = [post(page, API_TASK), post(page, FE_TASK), post(page, DOCS_TASK)];
  await expect(api.locator('.op-post-head').first()).toContainText('@leadnot from youto@api');
  await expect(stateOf(api)).toHaveText('Working', { timeout: TURN_TIMEOUT });
  await expect(fe.locator('.op-reason')).toHaveText('Waiting for @api');
  await expect(docs.locator('.op-reason')).toHaveText('Waiting for @fe');

  const summary = page.getByRole('region', { name: 'Stories' }).locator('summary');
  await expect(summary).toContainText(`${STORY}0 of 3 answered`);
  await summary.focus();
  await page.keyboard.press('Enter');
  const rows = page.getByRole('list', { name: `Sub-tasks of ${STORY}` }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('on @api');
  await expect(rows.nth(2)).toContainText('on @fe');
  await inBothThemes(page, '5-started', '.main.op');

  const starts = requestsTo(page, START_NOW_URL, 'POST');
  finish('api');
  await expect(stateOf(api)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  await expect(fe.locator('.op-reason')).toHaveCount(0, { timeout: TURN_TIMEOUT });
  await expect(stateOf(fe)).toHaveText('Working', { timeout: TURN_TIMEOUT });
  expect(starts).toHaveLength(0);
  await expect(docs.locator('.op-reason')).toHaveText('Waiting for @fe');

  const startAnyway = docs.getByRole('button', { name: 'Start the request to @docs anyway' });
  await startAnyway.focus();
  await page.keyboard.press('Enter');
  await expect(startAnyway).toHaveCount(0);
  await expect(stateOf(docs)).toHaveText('Working', { timeout: TURN_TIMEOUT });
  expect(starts).toHaveLength(1);
  await expect(thread(page).locator('.op-post', { hasText: 'has ended' })).toHaveCount(0);

  finish('docs');
  await expect(stateOf(docs)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  finish('fe');
  await expect(stateOf(fe)).toHaveText('Answered', { timeout: TURN_TIMEOUT });

  const wrapUp = post(page, `Every sub-task of the story "${STORY}" has ended.`);
  await expect(wrapUp).toHaveCount(1, { timeout: TURN_TIMEOUT });
  await expect(wrapUp.locator('.op-post-head').first()).toContainText('Sparknot from youto@lead');
  await expect(stateOf(wrapUp)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  await expect(summary).toContainText('3 of 3 answered');
  await inBothThemes(page, '6-wrap-up', '.main.op');

  await wrapUp.getByRole('button', { name: 'Open @lead in chat' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Checkout plan');
  const header = page.locator('.bubble.from', { hasText: 'has ended' });
  await expect(header.locator('.from-head b')).toHaveText('From Spark');
  await expect(header.locator('.from-note')).toHaveText('not from you');
  const started = page.locator('section[data-turn] .op-line', { hasText: 'Started 3 chats' });
  await expect(started).toHaveCount(1);
  await expect(started).toContainText(NAME);
  await inBothThemes(page, '7-lead-chat', '.thread');
  await started.getByRole('button', { name: `Open outpost ${NAME}` }).click();
  await expect(outpostPage(page, NAME)).toBeVisible();
  await expect(thread(page).locator('.op-post', { hasText: 'has ended' })).toHaveCount(1);
});
