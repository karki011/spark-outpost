import { expect, type Page } from '@playwright/test';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import { openChats } from './navigation.ts';

export const SHOTS = process.env.CHAT_WIDE_SHOTS ?? 'test-results/chat-rail';
export const WIDE = { width: 2000, height: 1100 };
export const COLUMN = 880;
export const INDENT = 38;
export const PROMPTS = [
  'Fix the date divider #plan',
  'Compare the queue backends in a table',
  'Now break it #fail',
  'Summarise what changed across the calendar module and every component that reads dates',
];
export const LONG_LINE =
  "  if (flags.forceRedis || metrics.requestsPerSecond > config.redisThreshold) return createRedisStreamsBackend(config.redis, { consumerGroup: 'spark-workers', blockMs: 250 });";
export const WIDE_REPLY = [
  'Here is the comparison you asked for, with the options side by side.',
  '| Option | Throughput (req/s) | p50 latency | p99 latency | Memory | Notes on operating it in production over a long period |',
  '| --- | --- | --- | --- | --- | --- |',
  '| Postgres advisory locks | 12,400 | 3.1 ms | 22 ms | 180 MB | Simple, no new moving parts, contention shows up as lock waits you can already observe |',
  '| Redis streams | 48,900 | 0.9 ms | 9 ms | 420 MB | Fast, but one more service to run, back up and monitor |',
  '',
  'And the function that picks between them:',
  '```ts',
  'export async function chooseQueueBackend(config: QueueConfig, metrics: MetricsSnapshot): Promise<QueueBackend> {',
  LONG_LINE,
  '  return createPostgresBackend(config.database);',
  '}',
  '```',
  'A short one stays narrow:',
  '```sh',
  'pnpm test',
  '```',
  'Prose keeps its measure while the table and the long code line use the room.',
].join('\n');

export const LONG_TASKS = [
  'S0{ git show "origin/main:$1" | cat -n | sed -n "120,180p"; }; S0 apps/web/src/chat/Thread.tsx',
  'Continue past the budget?',
  'cd libs/features/pulse/domain && pnpm exec vitest run src/pulse-window.test.ts --reporter=dot',
  'cd /Users/someone/Documents/a-project-with-a-long-name/packages/contracts && pnpm typecheck',
];

export const rail = (page: Page) => page.getByRole('region', { name: 'Chat context' });
export const outline = (page: Page) => page.getByRole('navigation', { name: 'On this chat' });
export const ticks = (page: Page) => outline(page).getByRole('button');
export const preview = (page: Page) => outline(page).getByRole('tooltip');
export const turns = (page: Page) => page.locator('.thread section[aria-label="Turn"]');
export const workPanel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });
export const header = (page: Page) => page.getByRole('main').locator('.head');

export async function ask(page: Page, prompts: readonly string[]) {
  const input = page.getByRole('textbox', { name: 'Message' });
  for (const [index, text] of prompts.entries()) {
    await input.fill(text);
    await input.press('Enter');
    await expect(turns(page)).toHaveCount(index + 1);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
  }
}

export async function longChat(page: Page, prompts: readonly string[] = PROMPTS) {
  await page.setViewportSize(WIDE);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await ask(page, prompts);
}

export async function widenSecondReply(page: Page) {
  await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const detail = (await response.json()) as ConversationDetail;
    const second = detail.messages.filter((message) => message.role === 'assistant')[1];
    const messages = detail.messages.map((message) =>
      message.id === second?.id ? { ...message, content: WIDE_REPLY } : message,
    );
    await route.fulfill({ response, json: { ...detail, messages } });
  });
  await page.reload();
  await expect(page.locator('.md table')).toBeVisible();
}

export async function shoot(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/chat-wide-${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

export async function pageScroll(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

export async function composerGap(page: Page): Promise<number> {
  const [main, composer] = await Promise.all([
    page.getByRole('main').boundingBox(),
    page.locator('.composer').boundingBox(),
  ]);
  return main!.y + main!.height - (composer!.y + composer!.height);
}

interface Edges {
  left: number;
  right: number;
}

export async function columnEdges(page: Page) {
  return page.evaluate(() => {
    const edges = (selector: string): Edges => {
      const found = [...document.querySelectorAll(selector)];
      const box = found[found.length - 1]!.getBoundingClientRect();
      return { left: box.left, right: box.right };
    };
    return {
      thread: edges('.thread'),
      column: edges('.col'),
      prose: edges('.col .md > p'),
      head: edges('.col .ai-head'),
      name: edges('.col .ai-head .provider-name'),
      foot: edges('.col .turn-foot'),
      table: edges('.col .md-table'),
      composer: edges('.composer'),
      bubbleRight: edges('.col .bubble').right,
    };
  });
}
