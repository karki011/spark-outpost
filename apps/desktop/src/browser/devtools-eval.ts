import { BROWSER_EVAL_RESULT_MAX, BROWSER_EVAL_TIMEOUT_MS } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { PageToolError, sensitiveBackendIds } from './page-read.ts';
import { callOnNode, releaseWorld, sparkWorld } from './spark-world.ts';

export const FIELD_HIDDEN = '[masked]';
const MASK_MIN = 3;
const READ_VALUE = `function () {
  return typeof this.value === 'string' ? this.value : '';
}`;

interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
}

interface Evaluated {
  result?: RemoteObject;
  exceptionDetails?: {
    text?: string;
    exception?: RemoteObject;
  };
}

export interface EvaluateOutcome {
  type: string;
  value: string;
  exception: string | null;
  truncated: boolean;
  masked: number;
}

export const EVAL_TOO_SLOW = `The expression did not finish within ${BROWSER_EVAL_TIMEOUT_MS / 1000} s, so Spark stopped waiting. A promise it started may still run in the page.`;

function shown(result: RemoteObject | undefined): { type: string; value: string } {
  if (!result) return { type: 'undefined', value: 'undefined' };
  const type = result.subtype ? `${result.type}:${result.subtype}` : (result.type ?? 'undefined');
  if (result.unserializableValue) return { type, value: result.unserializableValue };
  if (result.type === 'undefined') return { type, value: 'undefined' };
  if (result.value !== undefined) {
    const text =
      typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2);
    return { type, value: text ?? String(result.value) };
  }
  return { type, value: result.description ?? type };
}

function spellings(value: string): string[] {
  return [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)];
}

export function maskValues(
  text: string,
  values: readonly string[],
): { text: string; masked: number } {
  const needles = [
    ...new Set(values.filter((value) => value.length >= MASK_MIN).flatMap(spellings)),
  ].sort((a, b) => b.length - a.length);
  let masked = 0;
  let kept = text;
  for (const needle of needles) {
    const parts = kept.split(needle);
    masked += parts.length - 1;
    kept = parts.join(FIELD_HIDDEN);
  }
  return { text: kept, masked };
}

export async function protectedValues(cdp: Cdp, filled: ReadonlySet<number>): Promise<string[]> {
  const nodes = new Set([...(await sensitiveBackendIds(cdp)), ...filled]);
  if (nodes.size === 0) return [];
  const world = await sparkWorld(cdp);
  const values: string[] = [];
  for (const node of nodes) {
    const value = await callOnNode<string>(cdp, world, node, READ_VALUE).catch(() => null);
    if (value) values.push(value);
  }
  await releaseWorld(cdp);
  return values;
}

function withinTime<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PageToolError('failed', EVAL_TOO_SLOW)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export async function evaluateInPage(
  cdp: Cdp,
  expression: string,
  filled: ReadonlySet<number>,
  timeoutMs = BROWSER_EVAL_TIMEOUT_MS,
): Promise<EvaluateOutcome> {
  const before = await protectedValues(cdp, filled);
  const evaluated = await withinTime(
    cdp.send<Evaluated>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
      timeout: timeoutMs,
    }),
    timeoutMs,
  );
  const thrown = evaluated.exceptionDetails;
  const answer = shown(thrown ? undefined : evaluated.result);
  const failure = thrown
    ? (thrown.exception?.description ??
      thrown.exception?.value?.toString() ??
      thrown.text ??
      'Error')
    : null;
  const values = [...new Set([...before, ...(await protectedValues(cdp, filled))])];
  const value = maskValues(answer.value, values);
  const exception = failure === null ? null : maskValues(failure, values);
  const truncated = value.text.length > BROWSER_EVAL_RESULT_MAX;
  return {
    type: thrown ? 'exception' : answer.type,
    value: truncated ? `${value.text.slice(0, BROWSER_EVAL_RESULT_MAX - 1)}…` : value.text,
    exception: exception === null ? null : exception.text.slice(0, 2000),
    truncated,
    masked: value.masked + (exception?.masked ?? 0),
  };
}
