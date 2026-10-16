import {
  calendarBridgeToHostSchema,
  type CalendarBridgeFromHost,
  type CalendarHostErrorCode,
  type CalendarHostRequest,
} from '@spark-outpost/contracts';
import type { BridgePort, WorkerBridge } from '../browser/bridge.ts';
import { CalendarHelperError } from './helper-process.ts';

export type CalendarRun = (request: CalendarHostRequest) => Promise<unknown>;

export class CalendarHostError extends Error {
  readonly code: CalendarHostErrorCode;

  constructor(code: CalendarHostErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function codeOf(error: unknown): CalendarHostErrorCode {
  if (error instanceof CalendarHostError) return error.code;
  if (error instanceof CalendarHelperError)
    return error.code === 'stopped' ? 'cancelled' : error.code;
  return 'failed';
}

function failure(id: string, error: unknown): CalendarBridgeFromHost {
  const message = ((error as Error).message || 'The calendar could not do that.').slice(0, 500);
  return { kind: 'calendar:response', id, ok: false, code: codeOf(error), message };
}

function isCalendarRequest(raw: unknown): raw is { kind: 'calendar:request'; id: string } {
  const value = raw as { kind?: unknown; id?: unknown } | null;
  return value?.kind === 'calendar:request' && typeof value.id === 'string';
}

export interface CalendarBridge extends WorkerBridge {
  changed(): void;
}

export function connectCalendarBridge(port: BridgePort, run: CalendarRun): CalendarBridge {
  const running = new Set<string>();
  let closed = false;
  const post = (message: CalendarBridgeFromHost) => {
    if (!closed) port.post(message);
  };

  return {
    receive(raw) {
      const parsed = calendarBridgeToHostSchema.safeParse(raw);
      if (!parsed.success) {
        if (isCalendarRequest(raw)) {
          post(
            failure(
              raw.id,
              new CalendarHostError('invalid', 'That calendar request is not valid.'),
            ),
          );
        }
        return;
      }
      const message = parsed.data;
      if (message.kind === 'calendar:cancel' || running.has(message.id)) return;
      running.add(message.id);
      run(message.request)
        .then(
          (result) => post({ kind: 'calendar:response', id: message.id, ok: true, result }),
          (error: unknown) => post(failure(message.id, error)),
        )
        .finally(() => running.delete(message.id));
    },
    changed() {
      post({ kind: 'calendar:changed' });
    },
    close() {
      closed = true;
      running.clear();
    },
  };
}
