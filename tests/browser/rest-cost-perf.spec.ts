import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { ConversationDetail, Message } from '../../packages/contracts/src/conversations.ts';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island, openHome, openIsland } from './island-home-desktop.ts';
import { PRODUCTION, settledMetrics, writeReport } from './perf-probe.ts';
import {
  countCallbacks,
  hideWindow,
  restCostOver,
  runningAnimations,
  scriptsLoaded,
} from './rest-cost.ts';
import { seedChats } from './sidebar-seed.ts';
import { seedTourChats } from './tour-seed.ts';

test.use({ trace: 'off' });

const WINDOW_MS = 60_000;
const CHATS = 20;
const TURNS = 40;

const motion = (page: Page) => page.evaluate(() => document.documentElement.dataset.motion ?? null);

function reply(chat: number, turn: number): string {
  return Array.from({ length: 8 }, (_, index) =>
    `Chat ${chat}, turn ${turn}.${index}: the export keeps the currency column and the totals. `.repeat(
      6,
    ),
  ).join('\n\n');
}

function inflate(detail: ConversationDetail, chat: number): ConversationDetail {
  const [run] = detail.runs;
  const user = detail.messages.find((message) => message.role === 'user');
  if (!run || !user) return detail;
  const runs: ConversationDetail['runs'] = [];
  const messages: Message[] = [];
  for (let turn = 0; turn < TURNS; turn += 1) {
    const runId = turn === TURNS - 1 ? run.id : randomUUID();
    const userId = turn === TURNS - 1 ? user.id : randomUUID();
    runs.push({ ...run, id: runId, userMessageId: userId });
    messages.push(
      { ...user, id: userId, runId, content: `Turn ${turn}: update the export` },
      { ...user, id: randomUUID(), runId, role: 'assistant', content: reply(chat, turn) },
    );
  }
  return { ...detail, runs, messages };
}

async function growTranscripts(page: Page, titles: readonly string[]): Promise<void> {
  await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const detail = (await response.json()) as ConversationDetail;
    const chat = titles.indexOf(detail.conversation.title);
    await route.fulfill({ response, json: chat < 0 ? detail : inflate(detail, chat) });
  });
}

const mainNav = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

test('the app and Spark Island stay quiet at rest and while hidden', async ({ page, context }) => {
  test.setTimeout(300_000);
  await resetTestDatabase({ onboarded: true });
  await seedTourChats();
  await countCallbacks(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(mainNav(page, 'Home')).toBeVisible();
  await page.mouse.move(700, 450);

  const islandPage = await context.newPage();
  await countCallbacks(islandPage);
  await fakeHomeDesktop(islandPage);
  await openIsland(islandPage);
  await islandPage.mouse.move(640, 600);
  await expect(island(islandPage)).toHaveAttribute('data-view', 'peek');
  await islandPage.waitForTimeout(3_000);
  await expect.poll(() => motion(page), { timeout: 15_000 }).not.toBe('live');

  const [appResting, islandResting] = await restCostOver([page, islandPage], WINDOW_MS);
  await openHome(islandPage);
  const homeOpen = await runningAnimations(islandPage);
  await hideWindow(page, { blur: true });
  await hideWindow(islandPage, { blur: false });
  await expect(island(islandPage)).toHaveAttribute('data-view', 'panel');
  await page.waitForTimeout(1_000);
  const [appHidden, islandHidden] = await restCostOver([page, islandPage], WINDOW_MS);

  const summary = {
    windowSeconds: WINDOW_MS / 1000,
    hiddenBy: 'document.hidden override and visibilitychange, JS response only',
    app: { resting: appResting, hidden: appHidden, scripts: await scriptsLoaded(page) },
    island: {
      resting: islandResting,
      homeOpenAnimations: homeOpen,
      hiddenWithHomeOpen: islandHidden,
      scripts: await scriptsLoaded(islandPage),
      settledHeapMb: (await settledMetrics(islandPage)).heapMb,
    },
  };
  writeReport('rest-cost', summary);
  test.info().annotations.push({ type: 'rest cost', description: JSON.stringify(summary) });

  if (PRODUCTION) expect.soft(islandResting!.busyPercent).toBeLessThan(2);
  expect.soft(islandHidden!.framesPerSecond).toBeLessThan(1);
  expect.soft(Object.keys(islandHidden!.runningAnimations)).toEqual([]);
  expect.soft(Object.keys(islandResting!.runningAnimations)).toEqual([]);
});

test('opening and leaving 20 chats keeps the heap near where it started', async ({ page }) => {
  test.setTimeout(300_000);
  await resetTestDatabase({ onboarded: true });
  const titles = Array.from({ length: CHATS }, (_, index) => `Export chat ${index + 1}`);
  await seedChats(titles.map((title) => ({ title, run: { status: 'succeeded' } })));
  await growTranscripts(page, titles);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await mainNav(page, 'Chats').click();
  const chats = page.getByRole('navigation', { name: 'Chats' });
  await expect(chats.getByText(titles[0]!, { exact: true })).toBeVisible();
  await page.waitForTimeout(1_000);
  const before = await settledMetrics(page);

  for (const title of titles) {
    await chats.getByText(title, { exact: true }).click();
    await expect(page.locator('.thread section[aria-label="Turn"]')).toHaveCount(TURNS, {
      timeout: 30_000,
    });
  }
  await mainNav(page, 'Home').click();
  await page.waitForTimeout(2_000);
  const after = await settledMetrics(page);

  const summary = {
    chats: CHATS,
    turnsPerChat: TURNS,
    heapMb: { before: before.heapMb, after: after.heapMb },
    growthMb: Number((after.heapMb - before.heapMb).toFixed(1)),
    nodes: after.nodes - before.nodes,
  };
  writeReport('chat-heap', summary);
  test.info().annotations.push({ type: 'chat heap', description: JSON.stringify(summary) });
  expect(summary.growthMb).toBeLessThan(20);

  const transcriptRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/conversations\/[0-9a-f-]{36}$/.test(request.url())) {
      transcriptRequests.push(request.url());
    }
  });
  await mainNav(page, 'Chats').click();
  await chats.getByText(titles[CHATS - 2]!, { exact: true }).click();
  await expect(page.locator('.thread section[aria-label="Turn"]')).toHaveCount(TURNS);
  await chats.getByText(titles[0]!, { exact: true }).click();
  await expect(page.locator('.thread section[aria-label="Turn"]')).toHaveCount(TURNS, {
    timeout: 30_000,
  });
  await expect(page.locator('.thread')).toContainText('Chat 0, turn 0.0');
  expect(transcriptRequests.length).toBeGreaterThan(0);
});
