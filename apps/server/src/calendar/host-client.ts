import type { z } from 'zod';
import {
  BROWSER_HOST_ENV,
  CALENDAR_REQUEST_TIMEOUT_MS,
  calendarBridgeFromHostSchema,
  calendarHostResultSchemas,
  type CalendarBridgeToHost,
  type CalendarHostErrorCode,
  type CalendarHostOp,
  type CalendarHostRequest,
} from '@spark-outpost/contracts';
import {
  createBridgeClient,
  type BridgeAnswer,
  type BridgePort,
} from '../browser/bridge-client.ts';

export type CalendarHostResult<Op extends CalendarHostOp> = z.infer<
  (typeof calendarHostResultSchemas)[Op]
>;

export interface CalendarHost {
  request<Op extends CalendarHostOp>(
    request: Extract<CalendarHostRequest, { op: Op }>,
  ): Promise<CalendarHostResult<Op>>;
  onChanged(listener: () => void): void;
}

export type CalendarHostFailure = CalendarHostErrorCode | 'timeout';

export class CalendarHostError extends Error {
  readonly code: CalendarHostFailure;

  constructor(code: CalendarHostFailure, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CalendarHostClientOptions {
  port: BridgePort<CalendarBridgeToHost>;
  timeoutMs?: number;
  newId?: () => string;
}

export function createCalendarHostClient(options: CalendarHostClientOptions): CalendarHost {
  const listeners = new Set<() => void>();
  options.port.subscribe((raw) => {
    const parsed = calendarBridgeFromHostSchema.safeParse(raw);
    if (parsed.success && parsed.data.kind === 'calendar:changed') {
      for (const listener of listeners) listener();
    }
  });
  const request = createBridgeClient({
    port: options.port,
    timeoutMs: options.timeoutMs ?? CALENDAR_REQUEST_TIMEOUT_MS,
    ...(options.newId ? { newId: options.newId } : {}),
    answer: (raw): BridgeAnswer | null => {
      const parsed = calendarBridgeFromHostSchema.safeParse(raw);
      if (!parsed.success || parsed.data.kind !== 'calendar:response') return null;
      return parsed.data;
    },
    results: calendarHostResultSchemas,
    request: (id, sent) =>
      ({ kind: 'calendar:request', id, request: sent }) as CalendarBridgeToHost,
    cancel: (id) => ({ kind: 'calendar:cancel', id }) as const,
    failure: (code, message) => new CalendarHostError(code as CalendarHostFailure, message),
    timeoutMessage: 'The calendar took too long to answer.',
    invalidMessage: 'The calendar sent an answer Spark cannot read.',
  });
  return {
    request: (sent) => request(sent) as never,
    onChanged: (listener) => listeners.add(listener),
  };
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

export function connectDesktopCalendar(env: NodeJS.ProcessEnv, owner: object): CalendarHost | null {
  const parent = (owner as { parentPort?: ParentPort }).parentPort;
  if (env[BROWSER_HOST_ENV] !== '1' || !parent) return null;
  return createCalendarHostClient({
    port: {
      post: (message) => parent.postMessage(message),
      subscribe: (listener) => parent.on('message', (event) => listener(event.data)),
    },
  });
}
