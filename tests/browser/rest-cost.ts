import type { Page } from '@playwright/test';
import { pageMetrics } from './perf-probe.ts';

interface RestCounts {
  frames: number;
  timers: number;
}

export interface RestCost {
  busyPercent: number;
  recalcsPerSecond: number;
  layoutsPerSecond: number;
  framesPerSecond: number;
  timersPerSecond: number;
  runningAnimations: Record<string, number>;
  heapMb: number;
}

export async function countCallbacks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counts = { frames: 0, timers: 0 };
    Object.assign(window, { restCounts: counts });
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      frame((time) => {
        counts.frames += 1;
        callback(time);
      });
    const counted = (handler: TimerHandler): TimerHandler =>
      typeof handler === 'function'
        ? (...args: unknown[]) => {
            counts.timers += 1;
            (handler as (...values: unknown[]) => void)(...args);
          }
        : handler;
    const timeout = window.setTimeout.bind(window);
    const interval = window.setInterval.bind(window);
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
      timeout(counted(handler), ms, ...args)) as typeof window.setTimeout;
    window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
      interval(counted(handler), ms, ...args)) as typeof window.setInterval;
  });
}

async function readCounts(page: Page): Promise<RestCounts> {
  return page.evaluate(() => ({ ...(window as unknown as { restCounts: RestCounts }).restCounts }));
}

async function styleCounts(page: Page): Promise<{ recalcs: number; layouts: number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return { recalcs: value('RecalcStyleCount'), layouts: value('LayoutCount') };
}

export async function runningAnimations(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const names: Record<string, number> = {};
    for (const animation of document.getAnimations()) {
      if (animation.playState !== 'running') continue;
      const name =
        'animationName' in animation
          ? String(animation.animationName)
          : 'transitionProperty' in animation
            ? `transition:${String(animation.transitionProperty)}`
            : 'script';
      names[name] = (names[name] ?? 0) + 1;
    }
    return names;
  });
}

interface Snapshot {
  at: number;
  taskMs: number;
  recalcs: number;
  layouts: number;
  counts: RestCounts;
}

async function snapshot(page: Page): Promise<Snapshot> {
  const [metrics, style, counts] = await Promise.all([
    pageMetrics(page),
    styleCounts(page),
    readCounts(page),
  ]);
  return { at: Date.now(), taskMs: metrics.taskMs, ...style, counts };
}

function perSecond(after: number, before: number, seconds: number): number {
  return Number(((after - before) / seconds).toFixed(2));
}

export async function restCostOver(pages: readonly Page[], ms: number): Promise<RestCost[]> {
  const before = await Promise.all(pages.map(snapshot));
  await new Promise((resolve) => setTimeout(resolve, ms));
  return Promise.all(
    pages.map(async (page, index) => {
      const after = await snapshot(page);
      const start = before[index]!;
      const seconds = (after.at - start.at) / 1000;
      return {
        busyPercent: Number((((after.taskMs - start.taskMs) / (seconds * 1000)) * 100).toFixed(2)),
        recalcsPerSecond: perSecond(after.recalcs, start.recalcs, seconds),
        layoutsPerSecond: perSecond(after.layouts, start.layouts, seconds),
        framesPerSecond: perSecond(after.counts.frames, start.counts.frames, seconds),
        timersPerSecond: perSecond(after.counts.timers, start.counts.timers, seconds),
        runningAnimations: await runningAnimations(page),
        heapMb: (await pageMetrics(page)).heapMb,
      };
    }),
  );
}

export async function hideWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

export async function scriptsLoaded(page: Page): Promise<{ files: number; kb: number }> {
  return page.evaluate(() => {
    const scripts = performance
      .getEntriesByType('resource')
      .filter((entry) => /\.(m?js|tsx?)(\?|$)/.test(entry.name)) as PerformanceResourceTiming[];
    const bytes = scripts.reduce((sum, entry) => sum + entry.decodedBodySize, 0);
    return { files: scripts.length, kb: Math.round(bytes / 1024) };
  });
}
