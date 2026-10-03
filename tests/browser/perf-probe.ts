import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { SERVER_LOG_DIR } from './stub-config.ts';

export const PRODUCTION = Boolean(process.env.SPARK_WEB_BUILD);
export const BUSY_MACHINE = (os.loadavg()[0] ?? 0) > os.cpus().length * 2;
export const TASK_LIMIT_MS = PRODUCTION ? (BUSY_MACHINE ? 150 : 100) : 400;
export const CLICK_LIMIT_MS = PRODUCTION ? (BUSY_MACHINE ? 200 : 100) : 1_000;
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
}

async function pauseProbe(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const probe = (window as unknown as Partial<ProbeWindow>).perfProbe;
    if (!probe?.running) return false;
    probe.running = false;
    return true;
  });
}

async function resumeProbe(page: Page): Promise<void> {
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
}

export async function takeProbe(page: Page): Promise<ProbeResult> {
  const probe = await page.evaluate(() => {
    const scope = (window as unknown as ProbeWindow).perfProbe;
    const result = { long: scope.long.splice(0), gaps: scope.gaps.splice(0), frames: scope.frames };
    scope.frames = 0;
    return result;
  });
  return {
    longTasks: probe.long,
    maxTaskMs: Math.max(0, ...probe.long),
    frames: probe.frames,
    slowFrames: probe.gaps.length,
    maxFrameGapMs: Math.max(0, ...probe.gaps),
  };
}

export async function clickFeedbackMs(target: Locator): Promise<number> {
  const ms = await target.evaluate(
    (element: HTMLElement) =>
      new Promise<number>((resolve) => {
        const started = performance.now();
        element.click();
        requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - started), 0));
      }),
  );
  return Math.round(ms);
}

export async function keyFeedbackMs(page: Page, key: string): Promise<number> {
  const started = Date.now();
  await page.keyboard.press(key);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
  );
  return Date.now() - started;
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
        await cdp.send('Performance.enable');
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
  if (paused) await resumeProbe(page);
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
