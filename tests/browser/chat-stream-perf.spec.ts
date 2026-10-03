import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openHeavyChat } from './heavy-chat.ts';
import {
  CLICK_LIMIT_MS,
  keyFeedbackMs,
  settledMetrics,
  startProbe,
  takeProbe,
  TASK_LIMIT_MS,
  writeReport,
  waitForText,
  type PageMetrics,
} from './perf-probe.ts';

test.use({ trace: 'off' });

const WORDS = 220;
const SOAK_MS = Number(process.env.SPARK_SOAK_MS ?? 0);
const HEAP_GROWTH_MB = 25;
const NODE_GROWTH = 6_000;
const LISTENER_GROWTH = 400;

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
  const keyMs = await keyFeedbackMs(page, 'Enter');
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

test('a heavy chat streams a long reply smoothly without leaking', async ({ page }) => {
  test.setTimeout(240_000 + SOAK_MS * 2);
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await countCommits(page);
  let detailFetches = 0;
  page.on('request', (request) => {
    if (/\/api\/conversations\/[0-9a-f-]{36}$/.test(request.url())) detailFetches++;
  });
  await openHeavyChat(page, true);
  await page.waitForTimeout(1_500);
  const before = await settledMetrics(page);
  await startProbe(page);
  const startCommits = await commits(page);
  const startFetches = detailFetches;
  const started = Date.now();
  const sendKeyMs = await sendAndStream(page, 0);
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
  const leaks = growth(before, after);

  await page.screenshot({ path: 'test-results/smooth-audit/chat-stream.png' });
  const summary = {
    words: WORDS,
    streamMs,
    sendKeyMs,
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
  writeReport(SOAK_MS > 0 ? 'chat-soak' : 'chat-stream', summary);
  test.info().annotations.push({ type: 'chat stream', description: JSON.stringify(summary) });

  expect(sendKeyMs).toBeLessThan(CLICK_LIMIT_MS);
  expect(stream.maxTaskMs).toBeLessThan(TASK_LIMIT_MS);
  expect(summary.reactCommitsPerSecond).toBeLessThan(70);
  expect(streamFetches).toBeLessThan(Math.max(12, streamMs / 500));
  expect(leaks.heapMb).toBeLessThan(HEAP_GROWTH_MB);
  expect(leaks.nodes).toBeLessThan(NODE_GROWTH);
  expect(leaks.listeners).toBeLessThan(LISTENER_GROWTH);
});
