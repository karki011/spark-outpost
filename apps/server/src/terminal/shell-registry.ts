import type { Queryable } from '../persistence/db.ts';
import { forgetShell, recordShell } from '../persistence/terminal-shells.ts';
import type { ShellWatcher } from './sessions.ts';

export function shellRegistry(db: Queryable, workspaceId: string): ShellWatcher {
  let writes: Promise<void> = Promise.resolve();
  const queue = (write: () => Promise<void>) => {
    writes = writes
      .then(write)
      .catch((error: unknown) => console.error('Could not update the open terminals', error));
  };
  return {
    opened: (shell) => queue(() => recordShell(db, workspaceId, shell)),
    ended: (id) => queue(() => forgetShell(db, id)),
  };
}
