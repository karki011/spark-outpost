import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { AdvisorTimeoutError } from '../../apps/server/src/advisor/advice.ts';
import {
  askSystemOne,
  jevUsage,
  JEV_LATEST,
  JEV_TIMEOUT_MS,
  type SystemOneRequest,
} from '../../apps/server/src/advisor/jev.ts';
import { askHaiku } from './versus-ask.ts';
import type { Item } from './versus-items.ts';

export interface ResultRow {
  item: string;
  variant: string;
  key: string | null;
  ok: boolean;
  failure: string | null;
  wallMs: number;
  apiMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  cliCostUsd: number | null;
  answers: Record<string, unknown> | null;
}

export const SINGLE_KEYS_PER_ITEM = 6;
const HAIKU_TIMEOUT_MS = 120_000;
const KEY_PRIORITY = [
  'need',
  'vague',
  'destructive',
  'verdict',
  'intent',
  'complexity',
  'builders',
];

export function readRows(file: string): ResultRow[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ResultRow);
}

const rowKey = (item: string, variant: string, key: string | null) =>
  `${item}|${variant}|${key ?? ''}`;

export function singleKeys(request: SystemOneRequest): string[] {
  const keys = Object.keys(request.questions);
  const rank = (key: string) => {
    const index = KEY_PRIORITY.indexOf(key);
    return index === -1 ? KEY_PRIORITY.length : index;
  };
  return keys.toSorted((a, b) => rank(a) - rank(b)).slice(0, SINGLE_KEYS_PER_ITEM);
}

async function pooled<T>(work: readonly T[], size: number, run: (entry: T) => Promise<boolean>) {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < work.length) {
      const entry = work[next]!;
      next += 1;
      if (!(await run(entry))) stopped = true;
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
}

export interface RunOptions {
  out: string;
  concurrency: number;
  spendLimitUsd: number;
}

export interface Spend {
  usd: number;
  calls: number;
  stoppedAtLimit: boolean;
}

function spentSoFar(rows: readonly ResultRow[], isJev: boolean): number {
  return rows
    .filter((row) => (row.variant === 'jev') === isJev)
    .reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
}

export async function runJev(
  items: readonly Item[],
  apiKey: string,
  options: RunOptions,
): Promise<Spend> {
  const existing = readRows(options.out);
  const done = new Set(existing.map((row) => rowKey(row.item, row.variant, row.key)));
  const spend: Spend = { usd: spentSoFar(existing, true), calls: 0, stoppedAtLimit: false };
  const todo = items.filter((item) => !done.has(rowKey(item.id, 'jev', null)));
  await pooled(todo, options.concurrency, async (item) => {
    if (spend.usd >= options.spendLimitUsd) {
      spend.stoppedAtLimit = true;
      return false;
    }
    const startedAt = Date.now();
    const base = { item: item.id, variant: 'jev', key: null, apiMs: null, cliCostUsd: null };
    let row: ResultRow;
    try {
      const response = await askSystemOne(
        {
          baseUrl: process.env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai',
          apiKey,
          model: JEV_LATEST,
          fetch,
          timeoutMs: JEV_TIMEOUT_MS,
          pauseOnFailure: false,
        },
        item.request,
        new AbortController().signal,
      );
      const usage = jevUsage(item.request, response);
      row = {
        ...base,
        ok: true,
        failure: null,
        wallMs: Date.now() - startedAt,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
        answers: response.answers,
      };
    } catch (error) {
      row = {
        ...base,
        ok: false,
        failure:
          error instanceof AdvisorTimeoutError
            ? 'timeout'
            : error instanceof Error
              ? error.message
              : 'failed',
        wallMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        answers: null,
      };
    }
    spend.usd += row.costUsd ?? 0;
    spend.calls += 1;
    appendFileSync(options.out, `${JSON.stringify(row)}\n`);
    return true;
  });
  return spend;
}

export interface HaikuVariant {
  name: string;
  mode: 'batch' | 'single';
  effort: string;
  merge?: number;
}

interface HaikuJob {
  items: Item[];
  key: string | null;
  request: SystemOneRequest;
}

const part = (index: number) => `r${index + 1}`;
const mergedKey = (index: number, key: string) => `${part(index)}__${key}`;

function merged(items: Item[]): HaikuJob {
  const questions: Record<string, unknown> = {};
  items.forEach((item, index) => {
    for (const [key, question] of Object.entries(item.request.questions)) {
      questions[mergedKey(index, key)] = {
        ...(question as object),
        about: `Judge this only from the part of the state under "${part(index)}".`,
      };
    }
  });
  const state = Object.fromEntries(items.map((item, index) => [part(index), item.request.state]));
  return { items, key: null, request: { state, questions } };
}

function mergedJobs(items: readonly Item[], size: number): HaikuJob[] {
  const uses = [...new Set(items.map((item) => item.use))];
  return uses.flatMap((use) => {
    const group = items.filter((item) => item.use === use);
    return Array.from({ length: Math.ceil(group.length / size) }, (_, index) =>
      merged(group.slice(index * size, (index + 1) * size)),
    );
  });
}

function jobsFor(item: Item, variant: HaikuVariant): HaikuJob[] {
  if (variant.mode === 'batch') return [{ items: [item], key: null, request: item.request }];
  return singleKeys(item.request).map((key) => ({
    items: [item],
    key,
    request: { state: item.request.state, questions: { [key]: item.request.questions[key] } },
  }));
}

function answersFor(job: HaikuJob, index: number, answers: Record<string, unknown> | null) {
  if (!answers || job.items.length === 1) return answers;
  const prefix = mergedKey(index, '');
  return Object.fromEntries(
    Object.entries(answers)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}

export async function runHaiku(
  items: readonly Item[],
  variant: HaikuVariant,
  cwd: string,
  options: RunOptions,
): Promise<Spend> {
  const existing = readRows(options.out);
  const done = new Set(existing.map((row) => rowKey(row.item, row.variant, row.key)));
  const spend: Spend = { usd: spentSoFar(existing, false), calls: 0, stoppedAtLimit: false };
  const fresh = (job: HaikuJob) =>
    job.items.some((item) => !done.has(rowKey(item.id, variant.name, job.key)));
  const jobs = variant.merge
    ? mergedJobs(items, variant.merge)
    : items.flatMap((item) => jobsFor(item, variant));
  await pooled(jobs.filter(fresh), options.concurrency, async (job) => {
    if (spend.usd >= options.spendLimitUsd) {
      spend.stoppedAtLimit = true;
      return false;
    }
    const call = await askHaiku(job.request, {
      effort: variant.effort,
      cwd,
      timeoutMs: HAIKU_TIMEOUT_MS,
    });
    const share = job.items.length;
    const perItem = (value: number | null | undefined) =>
      value === null || value === undefined ? null : value / share;
    job.items.forEach((item, index) => {
      const row: ResultRow = {
        item: item.id,
        variant: variant.name,
        key: job.key,
        ok: call.ok,
        failure: call.failure,
        wallMs: call.wallMs,
        apiMs: call.apiMs,
        inputTokens: call.tokens
          ? perItem(call.tokens.input + call.tokens.cacheRead + call.tokens.cacheWrite)
          : null,
        outputTokens: perItem(call.tokens?.output),
        costUsd: perItem(call.costUsd),
        cliCostUsd: perItem(call.cliCostUsd),
        answers: answersFor(job, index, call.answers),
      };
      appendFileSync(options.out, `${JSON.stringify(row)}\n`);
    });
    spend.usd += call.costUsd ?? 0;
    spend.calls += 1;
    return true;
  });
  return spend;
}
