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

export interface ChatPortWatcherOptions {
  probe: PortProbe;
  agentRoots: () => readonly PortRoot[];
  excluded: ReadonlySet<number>;
  changed: (ports: ChatPortMap) => void;
  everyMs?: number;
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
  const log = options.log ?? ((message, error) => console.warn(message, error));
  const shells = new Map<string, WatchedShell>();
  let current: ChatPortMap = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ticking = false;
  let again = false;
  let stopped = false;
  let reported = false;

  const schedule = () => {
    if (ticking) again = true;
    if (stopped || ticking || timer !== null) return;
    timer = setTimeout(() => void tick(), everyMs);
    timer.unref?.();
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

  const measure = async (): Promise<{ map: ChatPortMap; watching: boolean }> => {
    const roots = await rootsNow();
    if (roots.length === 0) return { map: {}, watching: false };
    const children = await probe.children();
    const pids = new Set(roots.flatMap((root) => descendantsOf(root.pid, children)));
    const listening = await probe.listening([...pids].sort((a, b) => a - b));
    return { map: portsByChat(roots, children, listening, options.excluded), watching: true };
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
      if (!stopped && !samePortMap(current, measured.map)) {
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
      schedule();
    },
    ended(id) {
      if (shells.delete(id)) schedule();
    },
    ports: () => current,
    wake: schedule,
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
