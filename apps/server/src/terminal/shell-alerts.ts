import type { ShellAlert } from '../persistence/shell-alerts.ts';
import { shellAlertReader } from './shell-alert-reader.ts';
import type { ShellWatcher } from './sessions.ts';

interface WatchedShell {
  conversationId: string;
  label: string;
  read: (data: string) => string[];
  lastAt: number;
  pending: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export const SHELL_ALERT_GAP_MS = 3_000;

export function shellAlerts(
  record: (alert: ShellAlert) => void,
  now: () => number = Date.now,
): Required<ShellWatcher> {
  const shells = new Map<string, WatchedShell>();

  const send = (id: string, shell: WatchedShell, message: string) => {
    shell.lastAt = now();
    shell.pending = null;
    record({ conversationId: shell.conversationId, shellId: id, label: shell.label, message });
  };

  const flush = (id: string, shell: WatchedShell) => {
    shell.timer = null;
    if (shell.pending !== null) send(id, shell, shell.pending);
  };

  return {
    opened(shell) {
      if (!shell.conversationId || shell.agent) return;
      shells.set(shell.id, {
        conversationId: shell.conversationId,
        label: shell.label,
        read: shellAlertReader(),
        lastAt: -Infinity,
        pending: null,
        timer: null,
      });
    },
    output(id, data) {
      const shell = shells.get(id);
      if (!shell) return;
      const message = shell.read(data).at(-1);
      if (message === undefined) return;
      const wait = shell.lastAt + SHELL_ALERT_GAP_MS - now();
      if (wait <= 0 && shell.timer === null) return send(id, shell, message);
      shell.pending = message;
      shell.timer ??= setTimeout(() => flush(id, shell), Math.max(wait, 0));
    },
    ended(id) {
      const shell = shells.get(id);
      if (!shell) return;
      shells.delete(id);
      if (shell.timer) clearTimeout(shell.timer);
      flush(id, shell);
    },
  };
}
