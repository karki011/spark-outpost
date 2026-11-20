import {
  isAtMac,
  presenceBridgeToHostSchema,
  type PresenceBridgeFromHost,
} from '@spark-outpost/contracts';
import type { BridgePort, WorkerBridge } from './browser/bridge.ts';

export const PRESENCE_POLL_MS = 10_000;

type PowerEvent = 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume';

export interface PowerSource {
  getSystemIdleTime(): number;
  on(event: PowerEvent, listener: () => void): unknown;
  off(event: PowerEvent, listener: () => void): unknown;
}

export interface MacPresenceHost {
  connect(port: BridgePort): WorkerBridge;
  dispose(): void;
}

export function startMacPresence(power: PowerSource, pollMs = PRESENCE_POLL_MS): MacPresenceHost {
  const listening = new Set<BridgePort>();
  let locked = false;
  let asleep = false;
  let present = false;

  const presentNow = () => isAtMac({ idleSeconds: power.getSystemIdleTime(), locked, asleep });
  const message = (): PresenceBridgeFromHost => ({ kind: 'presence:state', present });
  const check = () => {
    const next = presentNow();
    if (next === present) return;
    present = next;
    for (const port of listening) port.post(message());
  };
  const setLocked = (next: boolean) => () => {
    locked = next;
    check();
  };
  const setAsleep = (next: boolean) => () => {
    asleep = next;
    check();
  };
  const handlers: [PowerEvent, () => void][] = [
    ['lock-screen', setLocked(true)],
    ['unlock-screen', setLocked(false)],
    ['suspend', setAsleep(true)],
    ['resume', setAsleep(false)],
  ];
  for (const [event, handler] of handlers) power.on(event, handler);
  present = presentNow();
  const timer = setInterval(check, pollMs);
  timer.unref?.();

  return {
    connect(port) {
      return {
        receive(raw) {
          if (!presenceBridgeToHostSchema.safeParse(raw).success) return;
          listening.add(port);
          port.post(message());
        },
        close: () => listening.delete(port),
      };
    },
    dispose() {
      clearInterval(timer);
      for (const [event, handler] of handlers) power.off(event, handler);
      listening.clear();
    },
  };
}
