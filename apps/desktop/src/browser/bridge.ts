import {
  browserBridgeToHostSchema,
  type BrowserBridgeFromHost,
  type BrowserHostRequest,
} from '@spark-outpost/contracts';
import { BrowserOpError } from './agent-ops.ts';

export interface BridgePort {
  post(message: unknown): void;
}

export interface BridgeHandlers {
  run(request: BrowserHostRequest, signal: AbortSignal): Promise<unknown>;
  ports(ports: readonly number[]): void;
}

export interface WorkerBridge {
  receive(message: unknown): void;
  close(): void;
}

function failure(id: string, error: unknown): BrowserBridgeFromHost {
  const code = error instanceof BrowserOpError ? error.code : 'failed';
  const message = ((error as Error).message || 'The browser could not do that.').slice(0, 500);
  return { kind: 'browser:response', id, ok: false, code, message };
}

export function connectWorkerBridge(port: BridgePort, handlers: BridgeHandlers): WorkerBridge {
  const running = new Map<string, AbortController>();
  let closed = false;

  const answer = (message: BrowserBridgeFromHost) => {
    if (!closed) port.post(message);
  };

  return {
    receive(raw) {
      const parsed = browserBridgeToHostSchema.safeParse(raw);
      if (!parsed.success) {
        const id = (raw as { id?: unknown } | null)?.id;
        if (
          (raw as { kind?: unknown } | null)?.kind === 'browser:request' &&
          typeof id === 'string'
        ) {
          answer(failure(id, new Error('That browser request is not valid.')));
        }
        return;
      }
      const message = parsed.data;
      if (message.kind === 'browser:ports') {
        handlers.ports(message.ports);
        return;
      }
      if (message.kind === 'browser:cancel') {
        running.get(message.id)?.abort();
        return;
      }
      if (running.has(message.id)) return;
      const controller = new AbortController();
      running.set(message.id, controller);
      handlers
        .run(message.request, controller.signal)
        .then(
          (result) => {
            if (controller.signal.aborted) {
              answer(failure(message.id, new BrowserOpError('cancelled', 'Cancelled.')));
            } else {
              answer({ kind: 'browser:response', id: message.id, ok: true, result });
            }
          },
          (error: unknown) => answer(failure(message.id, error)),
        )
        .finally(() => running.delete(message.id));
    },
    close() {
      closed = true;
      for (const controller of running.values()) controller.abort();
      running.clear();
    },
  };
}
