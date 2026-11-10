import { setTimeout as delay } from 'node:timers/promises';
import { BROWSER_BAD_SELECTOR } from '@spark-outpost/contracts';
import { BrowserHostError, type BrowserHostResult } from '../../../browser/host-client.ts';
import { SparkToolError, type SparkToolContext } from '../../tool.ts';
import { asToolError, browserSession } from './context.ts';

export const WAIT_DEFAULT_SECONDS = 30;
export const WAIT_MAX_SECONDS = 3000;
export const WAIT_POLL_MS = 250;
const BAD_SELECTOR_TRIES = 3;
export const NO_WAIT_SELECTOR = 'Pass the CSS selector to wait for.';

const PASSING_CODES = new Set(['failed', 'page_changed', 'load_failed', 'user_picking', 'timeout']);

type Inspected = BrowserHostResult<'inspect'>;

export interface WaitArgs {
  selector?: string | undefined;
  seconds?: number | undefined;
  tab?: string | undefined;
}

export interface Waited {
  found: Inspected;
  appeared: boolean;
  waitedMs: number;
}

function passing(error: unknown): boolean {
  return error instanceof BrowserHostError && PASSING_CODES.has(error.code);
}

function badSelector(error: unknown): boolean {
  return error instanceof BrowserHostError && error.message === BROWSER_BAD_SELECTOR;
}

export async function waitForSelector(
  args: WaitArgs,
  context: SparkToolContext,
  now: () => number = Date.now,
): Promise<Waited> {
  const selector = args.selector?.trim();
  if (!selector) throw new SparkToolError(NO_WAIT_SELECTOR);
  const session = browserSession(context);
  const request = {
    op: 'inspect',
    chatId: session.chatId,
    runId: session.runId,
    tab: args.tab,
    selector,
  } as const;
  const started = now();
  const deadline = started + (args.seconds ?? WAIT_DEFAULT_SECONDS) * 1000;
  let badTries = 0;
  for (;;) {
    try {
      const found = await session.host.request(request, context.signal);
      const appeared = found.matched > 0;
      if (appeared || now() >= deadline) return { found, appeared, waitedMs: now() - started };
      badTries = 0;
    } catch (error) {
      badTries = badSelector(error) ? badTries + 1 : 0;
      const gaveUp = badTries >= BAD_SELECTOR_TRIES || now() >= deadline;
      if (context.signal?.aborted || !passing(error) || gaveUp) throw asToolError(error);
    }
    await delay(WAIT_POLL_MS, undefined, context.signal ? { signal: context.signal } : {});
  }
}
