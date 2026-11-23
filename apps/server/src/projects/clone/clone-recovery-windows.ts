import {
  descendantsOf,
  killProcessTree,
  processTableOrNull,
  type ProcessRow,
} from '../../terminal/process-group.ts';

interface RecoveredClone {
  pid: number | null;
  destination: string;
}

export type WindowsRecovery =
  { action: 'keep' } | { action: 'clean' } | { action: 'stop'; tree: number[] };

export function windowsRecovery(
  marker: RecoveredClone,
  table: readonly ProcessRow[] | null,
  self: number,
): WindowsRecovery {
  if (!marker.pid) return { action: 'clean' };
  if (table === null) return { action: 'keep' };
  const row = table.find((entry) => entry.pid === marker.pid);
  if (!row) {
    return descendantsOf(marker.pid, table).length > 0 ? { action: 'keep' } : { action: 'clean' };
  }
  const cloning = row.args.includes(' clone ') && row.args.includes(marker.destination);
  if (!cloning) return { action: 'clean' };
  const parentRunning = table.some((entry) => entry.pid === row.ppid);
  if (parentRunning && row.ppid > 1 && row.ppid !== self) return { action: 'keep' };
  return { action: 'stop', tree: [marker.pid, ...descendantsOf(marker.pid, table)] };
}

export async function releaseWindowsOrphan(marker: RecoveredClone): Promise<boolean> {
  const table = await processTableOrNull();
  const decision = windowsRecovery(marker, table, process.pid);
  if (decision.action !== 'stop') return decision.action === 'clean';
  await killProcessTree(decision.tree[0]!, 0, 'SIGKILL');
  return treeStopped(decision.tree, await processTableOrNull());
}

export function treeStopped(tree: readonly number[], after: readonly ProcessRow[] | null): boolean {
  if (after === null) return false;
  const running = new Set(after.map((row) => row.pid));
  if (tree.some((pid) => running.has(pid))) return false;
  return tree.every((pid) => descendantsOf(pid, after).length === 0);
}
