import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserHostResult } from '../../../browser/host-client.ts';
import { SparkToolError, type SparkToolContext } from '../../tool.ts';
import { asToolError, browserSession } from './context.ts';

export const WAIT_DEFAULT_SECONDS = 30;
export const WAIT_MAX_SECONDS = 3000;
export const WAIT_POLL_MS = 250;

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

export async function waitForSelector(
  args: WaitArgs,
  context: SparkToolContext,
  now: () => number = Date.now,
): Promise<Waited> {
  const selector = args.selector?.trim();
  if (!selector) throw new SparkToolError('Pass the CSS selector to wait for.');
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
  for (;;) {
    const found = await session.host.request(request, context.signal).catch((error: unknown) => {
      throw asToolError(error);
    });
    const appeared = found.matched > 0;
    if (appeared || now() >= deadline) return { found, appeared, waitedMs: now() - started };
    await delay(WAIT_POLL_MS, undefined, context.signal ? { signal: context.signal } : {});
  }
}
