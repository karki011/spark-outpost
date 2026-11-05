import {
  macBridgeToHostSchema,
  type MacBridgeFromHost,
  type MacHostRequest,
} from '@spark-outpost/contracts';
import type { BridgePort, WorkerBridge } from '../browser/bridge.ts';
import { hostError, MacOpError } from './control.ts';

export type MacRun = (request: MacHostRequest, signal: AbortSignal) => Promise<unknown>;

function failure(id: string, error: unknown): MacBridgeFromHost {
  const known = hostError(error);
  return {
    kind: 'mac:response',
    id,
    ok: false,
    code: known.code,
    message: known.message.slice(0, 500),
  };
}

function isMacRequest(raw: unknown): raw is { kind: 'mac:request'; id: string } {
  const value = raw as { kind?: unknown; id?: unknown } | null;
  return value?.kind === 'mac:request' && typeof value.id === 'string';
}

export function connectMacBridge(port: BridgePort, run: MacRun): WorkerBridge {
  const running = new Map<string, AbortController>();
  let closed = false;
  const answer = (message: MacBridgeFromHost) => {
    if (!closed) port.post(message);
  };

  return {
    receive(raw) {
      const parsed = macBridgeToHostSchema.safeParse(raw);
      if (!parsed.success) {
        if (isMacRequest(raw)) {
          answer(
            failure(raw.id, new MacOpError('failed', 'That Mac control request is not valid.')),
          );
        }
        return;
      }
      const message = parsed.data;
      if (message.kind === 'mac:cancel') {
        running.get(message.id)?.abort();
        return;
      }
      if (running.has(message.id)) return;
      const controller = new AbortController();
      running.set(message.id, controller);
      run(message.request, controller.signal)
        .then(
          (result) => answer({ kind: 'mac:response', id: message.id, ok: true, result }),
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

export function joinBridges(bridges: readonly WorkerBridge[]): WorkerBridge {
  return {
    receive: (message) => {
      for (const bridge of bridges) bridge.receive(message);
    },
    close: () => {
      for (const bridge of bridges) bridge.close();
    },
  };
}
