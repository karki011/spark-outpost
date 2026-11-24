import type { PortProbe } from './chat-port-probe.ts';
import {
  descendantsOf,
  portsByChat,
  samePortMap,
  type ChatPortMap,
  type PortRoot,
} from './chat-ports.ts';
import type { ShellWatcher } from './session-types.ts';
import { sessionName } from './tmux/tmux-session.ts';

export const CHAT_PORTS_EVERY_MS = 3_000;
export const CHAT_PORTS_QUIET_EVERY_MS = 15_000;
export const CHAT_PORTS_QUIET_AFTER_TICKS = 20;

export interface ChatPortWatcherOptions {
  probe: PortProbe;
  agentRoots: () => readonly PortRoot[];
  excluded: ReadonlySet<number>;
  changed: (ports: ChatPortMap) => void;
  everyMs?: number;
  quietEveryMs?: number;
  log?: (message: string, error: unknown) => void;
}

export interface ChatPortWatcher extends ShellWatcher {
  ports(): ChatPortMap;
  wake(): void;
  stop(): void;
}

interface WatchedShell {
  conversationId: string;
  pid: number;
  agent: boolean;
}

export function chatPortWatcher(options: ChatPortWatcherOptions): ChatPortWatcher {
  const { probe, agentRoots, changed } = options;
  const everyMs = options.everyMs ?? CHAT_PORTS_EVERY_MS;
  const quietEveryMs = Math.max(everyMs, options.quietEveryMs ?? CHAT_PORTS_QUIET_EVERY_MS);
  const log = options.log ?? ((message, error) => console.warn(message, error));
  const shells = new Map<string, WatchedShell>();
  let current: ChatPortMap = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ticking = false;
  let again = false;
  let stopped = false;
  let reported = false;
  let unchangedTicks = 0;
  let lastPids = '';
  let timerIsQuiet = false;

  const schedule = () => {
    if (ticking) again = true;
    if (stopped || ticking || timer !== null) return;
    timerIsQuiet = unchangedTicks >= CHAT_PORTS_QUIET_AFTER_TICKS;
    timer = setTimeout(() => void tick(), timerIsQuiet ? quietEveryMs : everyMs);
    timer.unref?.();
  };

  const hurry = () => {
    unchangedTicks = 0;
    if (timer !== null && timerIsQuiet) {
      clearTimeout(timer);
      timer = null;
    }
    schedule();
  };

  const rootsNow = async (): Promise<PortRoot[]> => {
    const roots: PortRoot[] = [
      ...[...shells.values()].map((shell) => ({
        conversationId: shell.conversationId,
        pid: shell.pid,
        ...(shell.agent ? { agentCli: true } : {}),
      })),
      ...agentRoots(),
    ];
    if (![...shells.values()].some((shell) => shell.agent)) return roots;
    const panes = await probe.panes();
    for (const [id, shell] of shells) {
      if (!shell.agent) continue;
      for (const pid of panes.get(sessionName(id)) ?? []) {
        roots.push({ conversationId: shell.conversationId, pid, agentCli: true });
      }
    }
    return roots;
  };

  const measure = async (): Promise<{ map: ChatPortMap; watching: boolean; pids: string }> => {
    const roots = await rootsNow();
    if (roots.length === 0) return { map: {}, watching: false, pids: '' };
    const children = await probe.children();
    const pids = [...new Set(roots.flatMap((root) => descendantsOf(root.pid, children)))].sort(
      (a, b) => a - b,
    );
    const listening = await probe.listening(pids);
    return {
      map: portsByChat(roots, children, listening, options.excluded),
      watching: true,
      pids: pids.join(','),
    };
  };

  const tick = async () => {
    timer = null;
    ticking = true;
    again = false;
    let watching = true;
    try {
      const measured = await measure();
      watching = measured.watching;
      reported = false;
      const samePorts = samePortMap(current, measured.map);
      unchangedTicks = samePorts && measured.pids === lastPids ? unchangedTicks + 1 : 0;
      lastPids = measured.pids;
      if (!stopped && !samePorts) {
        current = measured.map;
        changed(current);
      }
    } catch (error) {
      if (!reported) log('Could not read the ports chats listen on', error);
      reported = true;
    } finally {
      ticking = false;
    }
    if (watching || again) schedule();
  };

  return {
    opened(shell) {
      if (!shell.conversationId) return;
      shells.set(shell.id, {
        conversationId: shell.conversationId,
        pid: shell.pid,
        agent: shell.agent === true,
      });
      hurry();
    },
    ended(id) {
      if (shells.delete(id)) hurry();
    },
    ports: () => current,
    wake: hurry,
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
