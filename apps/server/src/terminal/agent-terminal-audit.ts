import type { AgentTerminalStopper } from '@spark-outpost/contracts';
import type { AgentTerminalRow } from '../persistence/agent-terminals.ts';
import type { Db } from '../persistence/db.ts';
import { recordTerminalStop } from '../workflow/terminal-audit.ts';

const RECORDED_HERE: readonly AgentTerminalStopper[] = ['user', 'folder_removed', 'quit'];

function stopperRecordedHere(row: AgentTerminalRow): AgentTerminalStopper | null {
  if (row.status !== 'stopped' || row.stoppedBy === null) return null;
  return RECORDED_HERE.includes(row.stoppedBy) ? row.stoppedBy : null;
}

export async function recordTerminalStops(
  db: Db,
  rows: readonly AgentTerminalRow[],
): Promise<void> {
  for (const row of rows) {
    const by = stopperRecordedHere(row);
    if (!by) continue;
    await recordTerminalStop(db, row, by).catch((error: unknown) =>
      console.error('Could not record a terminal stop in the audit', error),
    );
  }
}
