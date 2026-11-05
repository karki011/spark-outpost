import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortProbe } from './chat-port-probe.ts';
import { chatPortWatcher, type ChatPortWatcher } from './chat-port-watcher.ts';
import type { ChatPortMap, PortRoot } from './chat-ports.ts';

const CHAT = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const EVERY = 3_000;

interface FakeProbe extends PortProbe {
  tree: Map<number, number[]>;
  open: Map<number, number[]>;
  sessions: Map<string, number[]>;
  asked: number[][];
  delayMs: number;
}

function fakeProbe(): FakeProbe {
  const probe: FakeProbe = {
    tree: new Map(),
    open: new Map(),
    sessions: new Map(),
    asked: [],
    delayMs: 0,
    children: async () => {
      if (probe.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, probe.delayMs));
      return probe.tree;
    },
    listening: async (pids) => {
      probe.asked.push([...pids]);
      return new Map([...probe.open].filter(([pid]) => pids.includes(pid)));
    },
    panes: async () => probe.sessions,
  };
  return probe;
}

let probe: FakeProbe;
let changes: ChatPortMap[];
let agents: PortRoot[];
let watcher: ChatPortWatcher;

beforeEach(() => {
  vi.useFakeTimers();
  probe = fakeProbe();
  changes = [];
  agents = [];
  watcher = chatPortWatcher({
    probe,
    agentRoots: () => agents,
    excluded: new Set([4318]),
    changed: (ports) => changes.push(ports),
    everyMs: EVERY,
  });
});

afterEach(() => {
  watcher.stop();
  vi.useRealTimers();
});

const tick = () => vi.advanceTimersByTimeAsync(EVERY);

function shell(id: string, pid: number, conversationId: string | null = CHAT, agent = false) {
  watcher.opened({
    id,
    conversationId,
    label: 'zsh',
    cwd: '/tmp',
    pid,
    ...(agent ? { agent } : {}),
  });
}

describe('chat ports', () => {
  it('reports a port a shell child listens on, once, and clears it when the tab ends', async () => {
    probe.tree.set(100, [200]);
    probe.open.set(200, [5173, 4318]);
    shell('s1', 100);
    await tick();
    expect(changes).toEqual([{ [CHAT]: [5173] }]);
    expect(watcher.ports()).toEqual({ [CHAT]: [5173] });

    await tick();
    expect(changes).toHaveLength(1);

    watcher.ended('s1');
    await tick();
    expect(changes).toEqual([{ [CHAT]: [5173] }, {}]);
    probe.asked.length = 0;
    await tick();
    await tick();
    expect(probe.asked).toEqual([]);
  });

  it('drops a port when its listener stops while the tab stays open', async () => {
    probe.open.set(100, [8080]);
    shell('s1', 100);
    await tick();
    probe.open.clear();
    await tick();
    expect(changes).toEqual([{ [CHAT]: [8080] }, {}]);
  });

  it('ignores shells with no chat and never starts for them', async () => {
    probe.open.set(100, [8080]);
    shell('s1', 100, null);
    await tick();
    expect(probe.asked).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("reads a Terminal session's tmux pane and ignores the agent CLI's own port", async () => {
    probe.sessions.set('spark-s2', [700]);
    probe.tree.set(700, [701]);
    probe.open.set(700, [50395]);
    probe.open.set(650, [50400]);
    probe.open.set(701, [3000]);
    shell('s2', 650, OTHER, true);
    await tick();
    expect(changes).toEqual([{ [OTHER]: [3000] }]);
    expect(probe.asked[0]).toEqual([650, 700, 701]);
  });

  it('starts watching agent terminals on wake and stops when they end', async () => {
    agents = [{ conversationId: CHAT, pid: 900 }];
    probe.open.set(900, [5000]);
    watcher.wake();
    await tick();
    expect(changes).toEqual([{ [CHAT]: [5000] }]);
    agents = [];
    await tick();
    expect(changes.at(-1)).toEqual({});
    probe.asked.length = 0;
    await tick();
    expect(probe.asked).toEqual([]);
  });

  it('never runs two probes at once when one is slow', async () => {
    probe.delayMs = EVERY * 2;
    let running = 0;
    let most = 0;
    const children = probe.children;
    probe.children = async () => {
      running += 1;
      most = Math.max(most, running);
      try {
        return await children();
      } finally {
        running -= 1;
      }
    };
    shell('s1', 100);
    watcher.wake();
    await vi.advanceTimersByTimeAsync(EVERY * 6);
    watcher.wake();
    await vi.advanceTimersByTimeAsync(EVERY * 4);
    expect(most).toBe(1);
  });

  it('keeps the last ports and logs once when the probe fails', async () => {
    const log = vi.fn();
    watcher.stop();
    watcher = chatPortWatcher({
      probe: { ...probe, children: () => Promise.reject(new Error('ps failed')) },
      agentRoots: () => [],
      excluded: new Set(),
      changed: (ports) => changes.push(ports),
      everyMs: EVERY,
      log,
    });
    shell('s1', 100);
    await tick();
    await tick();
    expect(log).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([]);
  });
});
