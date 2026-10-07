import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

export const STRICT = process.env.SPARK_PERF_STRICT === '1';
const STEAL_LIMIT = 1.25;
const CATEGORIES = [
  'disabled-by-default-devtools.timeline',
  'devtools.timeline',
  'blink.user_timing',
  '__metadata',
];

interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  tdur?: number;
  args?: { name?: string; elementCount?: number };
}

export interface Cost {
  wallMs: number;
  cpuMs: number;
}

export interface TaskSummary {
  tasks: number;
  longest: Cost;
  total: Cost;
  styleElements: number;
}

interface Recorder {
  cdp: CDPSession;
  events: TraceEvent[];
  running: boolean;
}

const recorders = new WeakMap<Page, Promise<Recorder>>();
let marks = 0;

function recorderFor(page: Page): Promise<Recorder> {
  let recorder = recorders.get(page);
  if (!recorder) {
    recorder = page
      .context()
      .newCDPSession(page)
      .then((cdp) => {
        const created: Recorder = { cdp, events: [], running: false };
        cdp.on('Tracing.dataCollected', (batch) => {
          created.events.push(...(batch.value as unknown as TraceEvent[]));
        });
        return created;
      });
    recorders.set(page, recorder);
  }
  return recorder;
}

async function tracing(page: Page): Promise<boolean> {
  const pending = recorders.get(page);
  return pending ? (await pending).running : false;
}

export async function beginTrace(page: Page): Promise<void> {
  const recorder = await recorderFor(page);
  if (recorder.running) return;
  await recorder.cdp.send('Tracing.start', {
    traceConfig: { includedCategories: CATEGORIES },
    transferMode: 'ReportEvents',
  });
  recorder.running = true;
}

async function pauseTrace(page: Page): Promise<TraceEvent[]> {
  const recorder = await recorderFor(page);
  if (!recorder.running) return recorder.events;
  const complete = new Promise((resolve) => recorder.cdp.once('Tracing.tracingComplete', resolve));
  await recorder.cdp.send('Tracing.end');
  await complete;
  recorder.running = false;
  return recorder.events;
}

export async function suspendTrace(page: Page): Promise<boolean> {
  const running = await tracing(page);
  if (running) await pauseTrace(page);
  return running;
}

export async function endTrace(page: Page): Promise<TaskSummary> {
  const events = await pauseTrace(page);
  const summary = summarise(mainTasks(events), events);
  (await recorderFor(page)).events = [];
  return summary;
}

interface MainTask extends Cost {
  startUs: number;
  endUs: number;
}

function mainTasks(events: readonly TraceEvent[]): MainTask[] {
  const byThread = new Map<string, MainTask[]>();
  const renderers = new Set(
    events
      .filter((event) => event.name === 'thread_name' && event.args?.name === 'CrRendererMain')
      .map((event) => `${event.pid}:${event.tid}`),
  );
  for (const event of events) {
    if (event.name !== 'RunTask' || event.ph !== 'X') continue;
    const thread = `${event.pid}:${event.tid}`;
    if (!renderers.has(thread)) continue;
    const wallUs = event.dur ?? 0;
    const tasks = byThread.get(thread) ?? [];
    tasks.push({
      startUs: event.ts,
      endUs: event.ts + wallUs,
      wallMs: wallUs / 1000,
      cpuMs: (event.tdur ?? wallUs) / 1000,
    });
    byThread.set(thread, tasks);
  }
  const busiest = [...byThread.values()].sort((a, b) => totalCpu(b) - totalCpu(a))[0];
  return busiest ?? [];
}

function totalCpu(tasks: readonly Cost[]): number {
  return tasks.reduce((sum, task) => sum + task.cpuMs, 0);
}

function round(cost: Cost): Cost {
  return { wallMs: Math.round(cost.wallMs), cpuMs: Math.round(cost.cpuMs) };
}

function summarise(tasks: readonly MainTask[], events: readonly TraceEvent[]): TaskSummary {
  const styleElements = events
    .filter((event) => event.name === 'UpdateLayoutTree' && event.ph === 'X')
    .map((event) => event.args?.elementCount ?? 0);
  return {
    tasks: tasks.length,
    longest: round({
      wallMs: Math.max(0, ...tasks.map((task) => task.wallMs)),
      cpuMs: Math.max(0, ...tasks.map((task) => task.cpuMs)),
    }),
    total: round({
      wallMs: tasks.reduce((sum, task) => sum + task.wallMs, 0),
      cpuMs: totalCpu(tasks),
    }),
    styleElements: Math.max(0, ...styleElements),
  };
}

function markTime(events: readonly TraceEvent[], name: string): number | null {
  return events.findLast((event) => event.name === name)?.ts ?? null;
}

async function markedCost(page: Page, mark: string, wallMs: number, keep: boolean): Promise<Cost> {
  const events = await pauseTrace(page);
  const from = markTime(events, `${mark}:start`);
  const to = markTime(events, `${mark}:end`);
  const between =
    from === null || to === null
      ? []
      : mainTasks(events).filter((task) => task.startUs < to && task.endUs > from);
  if (keep) await beginTrace(page);
  else (await recorderFor(page)).events = [];
  return round({ wallMs, cpuMs: between.length > 0 ? totalCpu(between) : wallMs });
}

export async function clickCost(target: Locator): Promise<Cost> {
  const page = target.page();
  const keep = await tracing(page);
  await beginTrace(page);
  const mark = `spark-perf-${++marks}`;
  const wallMs = await target.evaluate(
    (element: HTMLElement, name) =>
      new Promise<number>((resolve) => {
        performance.mark(`${name}:start`);
        const started = performance.now();
        element.click();
        requestAnimationFrame(() =>
          setTimeout(() => {
            performance.mark(`${name}:end`);
            resolve(performance.now() - started);
          }, 0),
        );
      }),
    mark,
  );
  return markedCost(page, mark, wallMs, keep);
}

export async function keyCost(page: Page, key: string): Promise<Cost> {
  const keep = await tracing(page);
  await beginTrace(page);
  const mark = `spark-perf-${++marks}`;
  await page.evaluate((name) => {
    const scope = window as unknown as { sparkKeyMs?: number };
    delete scope.sparkKeyMs;
    window.addEventListener(
      'keydown',
      () => {
        performance.mark(`${name}:start`);
        const started = performance.now();
        requestAnimationFrame(() =>
          setTimeout(() => {
            performance.mark(`${name}:end`);
            scope.sparkKeyMs = performance.now() - started;
          }, 0),
        );
      },
      { capture: true, once: true },
    );
  }, mark);
  await page.keyboard.press(key);
  const handle = await page.waitForFunction(
    () => (window as unknown as { sparkKeyMs?: number }).sparkKeyMs,
  );
  return markedCost(page, mark, (await handle.jsonValue()) ?? 0, keep);
}

export function stolenShare(total: Cost): number {
  return total.wallMs > 0 ? Number((1 - total.cpuMs / total.wallMs).toFixed(2)) : 0;
}

export function expectWithin(cost: Cost, limitMs: number, name: string): void {
  expect.soft(cost.cpuMs, `${name}: main-thread work in ms`).toBeLessThan(limitMs);
  if (STRICT) expect.soft(cost.wallMs, `${name}: wall-clock ms`).toBeLessThan(limitMs);
  else if (cost.wallMs >= limitMs && cost.cpuMs < limitMs) {
    test.info().annotations.push({
      type: 'wall-clock not judged',
      description: `${name} took ${cost.wallMs} ms on the clock for ${cost.cpuMs} ms of work; set SPARK_PERF_STRICT=1 on a quiet machine to hold the clock to ${limitMs} ms`,
    });
  }
}

function machineSteal(): number {
  const wallStarted = process.hrtime.bigint();
  const cpuStarted = process.cpuUsage();
  let sink = 0;
  while (Number(process.hrtime.bigint() - wallStarted) < 200_000_000) {
    for (let index = 0; index < 100_000; index++) sink += Math.sqrt(index);
  }
  const wallUs = Number(process.hrtime.bigint() - wallStarted) / 1000;
  const cpu = process.cpuUsage(cpuStarted);
  return sink > 0 ? wallUs / Math.max(1, cpu.user + cpu.system) : 1;
}

export function needsQuietMachine(): void {
  if (!STRICT) return;
  const steal = Math.min(machineSteal(), machineSteal());
  test.skip(
    steal > STEAL_LIMIT,
    `Strict performance run skipped: this process got ${Math.round(100 / steal)}% of a core, so wall-clock limits would measure the machine. Rerun when it is quiet.`,
  );
}
