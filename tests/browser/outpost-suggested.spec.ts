import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  NAME,
  TURN_TIMEOUT,
  inBothThemes,
  openOutpost,
  sheet,
  sidebar,
  threadPane,
} from './outposts-kit.ts';
import { send } from './project-chat-kit.ts';
import { PHONE, expectNoSidewaysScroll } from './responsive-kit.ts';
import { seedChats } from './sidebar-seed.ts';

const TASK = 'Add GET /usage.';
const NOTE = 'Pipeline notes for the usage work.';

let base: string;

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  base = mkdtempSync(path.join(tmpdir(), 'sos-'));
});

test.afterEach(() => rmSync(base, { recursive: true, force: true }));

const suggested = (page: Page) => page.getByRole('region', { name: 'Suggested threads' });

function proposal(): string {
  const chats = [
    {
      handle: 'api',
      title: 'Usage endpoint',
      project: 'shop',
      task: `${TASK}\n\n\n#build #sparkscript ${JSON.stringify([{ say: 'The endpoint is in.' }])}`,
    },
  ];
  const steps = [
    { tool: 'spark_outpost_draft', args: { title: 'Usage', chats } },
    { say: 'One chat is proposed.' },
  ];
  return `#build #sparkscript ${JSON.stringify(steps)}`;
}

async function leadProposes(page: Page): Promise<void> {
  await openChats(page);
  const folder = path.join(base, 'shop');
  mkdirSync(folder);
  const created = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(created.ok()).toBe(true);
  const { id: projectId } = (await created.json()) as { id: string };
  const [lead] = await seedChats([{ title: 'Checkout plan', projectIds: [projectId] }]);
  if (!lead) throw new Error('The lead chat was not seeded.');
  const id = randomUUID();
  const members = [{ conversationId: lead, handle: 'lead' }];
  const made = await page.request.post('/api/outposts', { data: { id, name: NAME, members } });
  expect(made.ok()).toBe(true);
  const noted = await page.request.post(`/api/outposts/${id}/posts`, {
    data: { id: randomUUID(), text: NOTE },
  });
  expect(noted.ok()).toBe(true);
  await openChats(page);
  await sidebar(page).getByText('Checkout plan').click();
  await send(page, proposal());
  const line = page.locator('section[data-turn] .op-line');
  await expect(line).toContainText('Proposed 1 chat', { timeout: TURN_TIMEOUT });
}

async function edges(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Not on screen.');
  return { left: box.x, right: box.x + box.width };
}

async function expectInMessageColumn(page: Page): Promise<void> {
  const box = suggested(page);
  const column = page.locator('.op-post', { hasText: NOTE }).locator('.op-msg-body');
  const [boxEdges, columnEdges, heading] = await Promise.all([
    edges(box),
    edges(column),
    edges(box.getByRole('heading', { name: 'Suggested threads' })),
  ]);
  expect(Math.abs(boxEdges.left - columnEdges.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxEdges.right - columnEdges.right)).toBeLessThanOrEqual(1);
  expect(heading.left - boxEdges.left).toBeGreaterThanOrEqual(12);
  const action = box.getByRole('button', { name: 'Review and start' });
  expect((await action.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(28);
}

async function reviewAndStart(page: Page): Promise<void> {
  await suggested(page).getByRole('button', { name: 'Review and start' }).click();
  const dialog = sheet(page, `Add chats to ${NAME}`);
  await dialog.getByRole('button', { name: /^Continue/ }).click();
  await dialog.getByRole('button', { name: /^Start chats/ }).click();
  await expect(dialog).toBeHidden({ timeout: TURN_TIMEOUT });
}

test('suggested threads sit in the message column and Start opens the started chat', async ({
  page,
}) => {
  await leadProposes(page);
  await openOutpost(page);
  await expect(suggested(page)).toContainText('@lead');
  await expect(suggested(page)).toContainText('Proposed 1 chat');
  await inBothThemes(page, 'suggested', () => expectInMessageColumn(page));

  await reviewAndStart(page);
  const pane = threadPane(page, 'api');
  await expect(pane).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(pane).toContainText(TASK);
  await expect(suggested(page)).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Back to Overview' })).toBeFocused();
  await inBothThemes(page, 'started', () => expect(pane).toBeVisible());

  await page.keyboard.press('Escape');
  const overview = page.getByRole('complementary', { name: 'Overview' });
  await expect(overview).toContainText(TASK);
  await inBothThemes(page, 'overview', () => expect(overview).toBeVisible());
});

test('at phone width the box fits the column and Start lands on the started thread', async ({
  page,
}) => {
  await leadProposes(page);
  await openOutpost(page);
  await page.setViewportSize(PHONE);
  await expect(suggested(page)).toBeVisible();
  await expectNoSidewaysScroll(page);
  await inBothThemes(page, 'suggested-phone', () => expectInMessageColumn(page));

  await reviewAndStart(page);
  await expect(threadPane(page, 'api')).toBeVisible({ timeout: TURN_TIMEOUT });
  await expectNoSidewaysScroll(page);
});
