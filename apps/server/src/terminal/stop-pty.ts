import { killProcessTree } from './process-group.ts';
import type { PtyProcess } from './pty.ts';

export function stopPty(pty: PtyProcess): Promise<void> {
  if (!pty.kill) return killProcessTree(pty.pid);
  if (process.platform !== 'win32') {
    pty.kill();
    return Promise.resolve();
  }
  const kill = pty.kill.bind(pty);
  return killProcessTree(pty.pid).finally(() => {
    try {
      kill();
    } catch {
      return;
    }
  });
}
