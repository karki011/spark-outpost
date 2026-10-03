import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
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
    requestAnimationFrame(tick);
  });
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
