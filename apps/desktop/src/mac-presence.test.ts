import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMacPresence, type MacPresenceHost, type PowerSource } from './mac-presence.ts';

class FakePower implements PowerSource {
  idle = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  getSystemIdleTime() {
    return this.idle;
  }

  on(event: string, listener: () => void) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }

  off(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  count() {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }
}

let power: FakePower;
let host: MacPresenceHost;
let posted: unknown[];

beforeEach(() => {
  vi.useFakeTimers();
  power = new FakePower();
  posted = [];
});

afterEach(() => {
  host.dispose();
  vi.useRealTimers();
});

function listen() {
  host = startMacPresence(power, 1000);
  const bridge = host.connect({ post: (message) => posted.push(message) });
  bridge.receive({ kind: 'presence:status' });
  return bridge;
}

describe('Mac presence', () => {
  it('answers a status request with whether the user is at the Mac', () => {
    listen();
    expect(posted).toEqual([{ kind: 'presence:state', present: true }]);
  });

  it('posts nothing to a port that never asked', () => {
    host = startMacPresence(power, 1000);
    host.connect({ post: (message) => posted.push(message) });
    host.connect({ post: (message) => posted.push(message) }).receive({ kind: 'meeting:status' });
    power.idle = 500;
    vi.advanceTimersByTime(1000);
    expect(posted).toEqual([]);
  });

  it('reports away after two minutes without input and back on new input', () => {
    listen();
    power.idle = 119;
    vi.advanceTimersByTime(1000);
    power.idle = 120;
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    power.idle = 0;
    vi.advanceTimersByTime(1000);
    expect(posted).toEqual([
      { kind: 'presence:state', present: true },
      { kind: 'presence:state', present: false },
      { kind: 'presence:state', present: true },
    ]);
  });

  it('counts a locked screen or a sleeping Mac as away at once', () => {
    listen();
    power.emit('lock-screen');
    power.emit('unlock-screen');
    power.emit('suspend');
    power.emit('resume');
    expect(posted.slice(1)).toEqual([
      { kind: 'presence:state', present: false },
      { kind: 'presence:state', present: true },
      { kind: 'presence:state', present: false },
      { kind: 'presence:state', present: true },
    ]);
  });

  it('stops posting to a closed port and lets go of the power events', () => {
    const bridge = listen();
    bridge.close();
    power.emit('lock-screen');
    expect(posted).toHaveLength(1);
    host.dispose();
    expect(power.count()).toBe(0);
  });
});
