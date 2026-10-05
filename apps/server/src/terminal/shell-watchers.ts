import type { ShellWatcher } from './sessions.ts';

export function shellWatchers(...watchers: readonly ShellWatcher[]): ShellWatcher {
  return {
    opened: (shell) => watchers.forEach((watcher) => watcher.opened(shell)),
    output: (id, data) => watchers.forEach((watcher) => watcher.output?.(id, data)),
    ended: (id) => watchers.forEach((watcher) => watcher.ended(id)),
  };
}
