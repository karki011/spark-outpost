import { BROWSER_HOST_ENV, presenceBridgeFromHostSchema } from '@spark-outpost/contracts';

export interface PresencePort {
  post(message: unknown): void;
  subscribe(listener: (message: unknown) => void): void;
}

export interface MacPresence {
  present(): boolean | null;
  onAway(listener: () => void): void;
}

export function createMacPresence(port: PresencePort): MacPresence {
  let present: boolean | null = null;
  const awayListeners = new Set<() => void>();
  port.subscribe((raw) => {
    const parsed = presenceBridgeFromHostSchema.safeParse(raw);
    if (!parsed.success) return;
    const left = present === true && !parsed.data.present;
    present = parsed.data.present;
    if (left) for (const listener of awayListeners) listener();
  });
  port.post({ kind: 'presence:status' });
  return {
    present: () => present,
    onAway: (listener) => awayListeners.add(listener),
  };
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

export function connectMacPresence(env: NodeJS.ProcessEnv, owner: object): MacPresence | null {
  const parent = (owner as { parentPort?: ParentPort }).parentPort;
  if (env[BROWSER_HOST_ENV] !== '1' || !parent) return null;
  return createMacPresence({
    post: (message) => parent.postMessage(message),
    subscribe: (listener) => parent.on('message', (event) => listener(event.data)),
  });
}
