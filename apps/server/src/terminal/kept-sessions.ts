import type { SpawnPty } from './pty.ts';
import { killTmuxServer, type TmuxHost } from './tmux/tmux-host.ts';
import { killSessionTree, killUnknownSessions, listSessionIds } from './tmux/tmux-session.ts';
import { tmuxSpawner } from './tmux/tmux-spawner.ts';

export interface KeptSessions {
  spawner(base: SpawnPty): SpawnPty;
  listSessionIds(): Promise<string[]>;
  killSessionTree(sessionId: string): Promise<void>;
  killUnknownSessions(): Promise<void>;
  stopAll(): unknown;
}

export function tmuxKept(host: TmuxHost): KeptSessions {
  return {
    spawner: (base) => tmuxSpawner(base, host),
    listSessionIds: () => listSessionIds(host),
    killSessionTree: (sessionId) => killSessionTree(host, sessionId),
    killUnknownSessions: () => killUnknownSessions(host),
    stopAll: () => killTmuxServer(host),
  };
}
