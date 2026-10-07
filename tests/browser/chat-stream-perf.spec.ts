import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openHeavyChat } from './heavy-chat.ts';
import {
  CLICK_LIMIT_MS,
  PRODUCTION,
  restingBusyPercent,
  settledMetrics,
  startProbe,
  takeProbe,
  TASK_LIMIT_MS,
  writeReport,
  waitForText,
  type PageMetrics,
} from './perf-probe.ts';
import { expectWithin, keyCost, needsQuietMachine } from './perf-trace.ts';

test.use({ trace: 'off' });

const WORDS = 220;
const SOAK_MS = Number(process.env.SPARK_SOAK_MS ?? 0);
const HEAP_GROWTH_MB = 25;
const NODE_GROWTH = 6_000;
const LISTENER_GROWTH = 400;
const IDLE_BUSY_LIMIT = PRODUCTION ? 6 : 30;

interface CommitWindow {
  reactCommits: number;
}

async function countCommits(page: Page) {
  await page.addInitScript(() => {
    const scope = window as unknown as CommitWindow & {
      __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
    };
    scope.reactCommits = 0;
    const renderers = new Map();
    scope.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers,
      inject: (renderer: unknown) => {
        renderers.set(renderers.size + 1, renderer);
        return renderers.size;
      },
      onCommitFiberRoot: () => {
        scope.reactCommits++;
      },
      onCommitFiberUnmount: () => undefined,
      onPostCommitFiberRoot: () => undefined,
      checkDCE: () => undefined,
    };
  });
}

const commits = (page: Page) =>
  page.evaluate(() => (window as unknown as CommitWindow).reactCommits);

function prompt(round: number): string {
  const words = Array.from({ length: WORDS }, (_, index) => `word${round}x${index}`);
  return `Explain the divider again ${words.join(' ')}`;
}

async function sendAndStream(page: Page, round: number) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(prompt(round));
  const keyMs = await keyCost(page, 'Enter');
  await waitForText(page, '.thread section:last-of-type .md', `word${round}x${WORDS - 1}`);
  await waitForText(page, '.thread section:last-of-type .mood', 'done');
  return keyMs;
}

function growth(before: PageMetrics, after: PageMetrics) {
  return {
    heapMb: Number((after.heapMb - before.heapMb).toFixed(1)),
    nodes: after.nodes - before.nodes,
    listeners: after.listeners - before.listeners,
  };
}

interface StreamCase {
  report: string;
  viewport: { width: number; height: number };
  rail: boolean;
}

async function streamHeavyChat(page: Page, { report, viewport, rail }: StreamCase) {
  needsQuietMachine();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize(viewport);
  await countCommits(page);
  let detailFetches = 0;
  page.on('request', (request) => {
    if (/\/api\/conversations\/[0-9a-f-]{36}$/.test(request.url())) detailFetches++;
  });
  await openHeavyChat(page, true);
  await expect(page.locator('.oticks')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Chat context' })).toHaveCount(rail ? 1 : 0);
  await page.waitForTimeout(1_500);
  const before = await settledMetrics(page);
  await startProbe(page);
  const startCommits = await commits(page);
  const startFetches = detailFetches;
  const started = Date.now();
  const sendKey = await sendAndStream(page, 0);
  const streamMs = Date.now() - started;
  const stream = await takeProbe(page);
  const streamCommits = (await commits(page)) - startCommits;
  const streamFetches = detailFetches - startFetches;

  let rounds = 1;
  const soakStarted = Date.now();
  while (Date.now() - soakStarted < SOAK_MS) {
    await sendAndStream(page, rounds);
    rounds++;
  }
  const soak = SOAK_MS > 0 ? await takeProbe(page) : null;
  await page.waitForTimeout(1_000);
  const after = await settledMetrics(page);
  const idleBusy = await restingBusyPercent(page);
  const leaks = growth(before, after);

  await page.screenshot({ path: `test-results/smooth-audit/${report}.png` });
  const summary = {
    words: WORDS,
    idleBusy,
    streamMs,
    sendKey,
    stream,
    reactCommitsPerSecond: Math.round(streamCommits / (streamMs / 1000)),
    detailFetches: streamFetches,
    soakMs: SOAK_MS,
    rounds,
    soak,
    before,
    after,
    growth: leaks,
  };
  writeReport(SOAK_MS > 0 ? `${report}-soak` : report, summary);
  test.info().annotations.push({ type: 'chat stream', description: JSON.stringify(summary) });

  expect.soft(idleBusy, 'main thread percent at rest').toBeLessThan(IDLE_BUSY_LIMIT);
  expectWithin(sendKey, CLICK_LIMIT_MS, 'Enter to next paint');
  expectWithin(stream.longestTask, TASK_LIMIT_MS, 'longest task while streaming');
  expect.soft(summary.reactCommitsPerSecond).toBeLessThan(70);
  expect.soft(streamFetches).toBeLessThan(Math.max(12, streamMs / 500));
  expect.soft(leaks.heapMb).toBeLessThan(HEAP_GROWTH_MB);
  expect.soft(leaks.nodes).toBeLessThan(NODE_GROWTH);
  expect.soft(leaks.listeners).toBeLessThan(LISTENER_GROWTH);
}

test('a heavy chat streams a long reply smoothly without leaking', async ({ page }) => {
  test.setTimeout(240_000 + SOAK_MS * 2);
  await streamHeavyChat(page, {
    report: 'chat-stream',
    viewport: { width: 1400, height: 900 },
    rail: false,
  });
});

test('the context rail and the tick rail add no work while a heavy chat streams', async ({
  page,
}) => {
  test.setTimeout(240_000 + SOAK_MS * 2);
  await streamHeavyChat(page, {
    report: 'chat-stream-rail',
    viewport: { width: 2000, height: 1100 },
    rail: true,
  });
});
