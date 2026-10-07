import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { beginTrace, endTrace, suspendTrace, type Cost, type TaskSummary } from './perf-trace.ts';
import { SERVER_LOG_DIR } from './stub-config.ts';

export const PRODUCTION = Boolean(process.env.SPARK_WEB_BUILD);
export const TASK_LIMIT_MS = PRODUCTION ? 100 : 400;
export const CLICK_LIMIT_MS = PRODUCTION ? 100 : 1_000;
export const REPORT_DIR = 'test-results/smooth-audit';
const LAG_MARKER = 'Event loop blocked';

interface ProbeWindow {
  perfProbe: { long: number[]; gaps: number[]; frames: number; running: boolean };
}

export async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = { long: [] as number[], gaps: [] as number[], frames: 0, running: true };
    (window as unknown as ProbeWindow).perfProbe = probe;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.long.push(Math.round(entry.duration));
    }).observe({ type: 'longtask' });
    let last = performance.now();
    const tick = (now: number) => {
      if (!probe.running) return;
      probe.frames++;
      const gap = now - last;
      if (gap > 34) probe.gaps.push(Math.round(gap));
      last = now;
      requestAnimationFrame(tick);
    };
    Object.assign(window, {
      perfProbeResume: () => {
        if (probe.running) return;
        probe.running = true;
        last = performance.now();
        requestAnimationFrame(tick);
      },
    });
    requestAnimationFrame(tick);
  });
  await beginTrace(page);
}

interface Paused {
  frames: boolean;
  trace: boolean;
}

async function pauseProbe(page: Page): Promise<Paused> {
  const frames = await page.evaluate(() => {
    const probe = (window as unknown as Partial<ProbeWindow>).perfProbe;
    if (!probe?.running) return false;
    probe.running = false;
    return true;
  });
  return { frames, trace: await suspendTrace(page) };
}

async function resumeProbe(page: Page, paused: Paused): Promise<void> {
  if (paused.trace) await beginTrace(page);
  if (!paused.frames) return;
  await page.evaluate(() =>
    (window as unknown as { perfProbeResume: () => void }).perfProbeResume(),
  );
}

export interface ProbeResult {
  longTasks: number[];
  maxTaskMs: number;
  frames: number;
  slowFrames: number;
  maxFrameGapMs: number;
  longestTask: Cost;
  work: TaskSummary;
}

export async function takeProbe(page: Page): Promise<ProbeResult> {
  const probe = await page.evaluate(() => {
    const scope = (window as unknown as ProbeWindow).perfProbe;
    const result = { long: scope.long.splice(0), gaps: scope.gaps.splice(0), frames: scope.frames };
    scope.frames = 0;
    return result;
  });
  const work = await endTrace(page);
  await beginTrace(page);
  return {
    longTasks: probe.long,
    maxTaskMs: Math.max(0, ...probe.long),
    frames: probe.frames,
    slowFrames: probe.gaps.length,
    maxFrameGapMs: Math.max(0, ...probe.gaps),
    longestTask: work.longest,
    work,
  };
}

export interface LagMark {
  api: number;
  worker: number;
}

function logLines(name: string): string[] {
  const file = path.join(SERVER_LOG_DIR, `${name}.log`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n');
}

export function markServerLogs(): LagMark {
  return { api: logLines('api').length, worker: logLines('worker').length };
}

export function lagWarningsSince(mark: LagMark): string[] {
  return [...logLines('api').slice(mark.api), ...logLines('worker').slice(mark.worker)].filter(
    (line) => line.includes(LAG_MARKER),
  );
}

export function lagMs(warnings: readonly string[]): number {
  const values = warnings.map((line) => Number(/for (\d+) ms/.exec(line)?.[1] ?? 0));
  return Math.max(0, ...values);
}

export function writeReport(name: string, data: unknown): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const record = {
    production: PRODUCTION,
    loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
    ...(data as object),
  };
  writeFileSync(path.join(REPORT_DIR, `${name}.json`), JSON.stringify(record, null, 2));
}

export interface PageMetrics {
  taskMs: number;
  heapMb: number;
  nodes: number;
  listeners: number;
}

const sessions = new WeakMap<Page, Promise<CDPSession>>();

function cdpFor(page: Page): Promise<CDPSession> {
  let session = sessions.get(page);
  if (!session) {
    session = page
      .context()
      .newCDPSession(page)
      .then(async (cdp) => {
        await cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
        return cdp;
      });
    sessions.set(page, session);
  }
  return session;
}

export async function pageMetrics(page: Page): Promise<PageMetrics> {
  const cdp = await cdpFor(page);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    taskMs: value('TaskDuration') * 1000,
    heapMb: Number((value('JSHeapUsedSize') / 1_048_576).toFixed(1)),
    nodes: value('Nodes'),
    listeners: value('JSEventListeners'),
  };
}

export async function idleBusyPercent(page: Page, ms = 2_000): Promise<number> {
  const before = await pageMetrics(page);
  const started = Date.now();
  await page.waitForTimeout(ms);
  const after = await pageMetrics(page);
  return Math.round(((after.taskMs - before.taskMs) / (Date.now() - started)) * 100);
}

export async function restingBusyPercent(page: Page, ms = 2_000): Promise<number> {
  const paused = await pauseProbe(page);
  await page.waitForFunction(() => document.documentElement.dataset.motion !== 'live', null, {
    polling: 250,
    timeout: 15_000,
  });
  const first = await idleBusyPercent(page, ms);
  const busy = Math.min(first, await idleBusyPercent(page, ms));
  await resumeProbe(page, paused);
  return busy;
}

export async function settledMetrics(page: Page): Promise<PageMetrics> {
  const cdp = await cdpFor(page);
  await cdp.send('HeapProfiler.collectGarbage');
  return pageMetrics(page);
}

export async function waitForText(
  page: Page,
  selector: string,
  text: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await page.evaluate(
      ({ selector, text }) =>
        [...document.querySelectorAll(selector)].some((element) =>
          element.textContent?.includes(text),
        ),
      { selector, text },
    );
    if (found) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for "${text}" in ${selector}`);
}

export interface FrameWork {
  busy: number;
  recalcs: number;
  layouts: number;
  paints: number;
}

async function paintsPerSecond(page: Page, ms: number): Promise<number> {
  const cdp = await cdpFor(page);
  let paints = 0;
  const count = (batch: { value: { name?: string }[] }) => {
    paints += batch.value.filter((event) => event.name === 'Paint').length;
  };
  cdp.on('Tracing.dataCollected', count);
  const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: ['devtools.timeline'] },
    transferMode: 'ReportEvents',
  });
  const started = Date.now();
  await page.waitForTimeout(ms);
  const seconds = (Date.now() - started) / 1000;
  await cdp.send('Tracing.end');
  await done;
  cdp.off('Tracing.dataCollected', count);
  return Math.round(paints / seconds);
}

export async function frameWork(page: Page, ms = 3_000): Promise<FrameWork> {
  const cdp = await cdpFor(page);
  const read = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
    return {
      task: value('TaskDuration'),
      recalcs: value('RecalcStyleCount'),
      layouts: value('LayoutCount'),
    };
  };
  const before = await read();
  const started = Date.now();
  await page.waitForTimeout(ms);
  const after = await read();
  const seconds = (Date.now() - started) / 1000;
  return {
    busy: Number((((after.task - before.task) / seconds) * 100).toFixed(1)),
    recalcs: Math.round((after.recalcs - before.recalcs) / seconds),
    layouts: Math.round((after.layouts - before.layouts) / seconds),
    paints: await paintsPerSecond(page, Math.min(ms, 2_000)),
  };
}
