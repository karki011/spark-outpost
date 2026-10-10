import type { AgentTerminalStopper } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import type { AgentTerminalRow } from '../persistence/agent-terminals.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';

export const TERMINAL_STOP_AUDIT = 'spark/terminal_stop';

const RECORDED_HERE: readonly AgentTerminalStopper[] = ['user', 'folder_removed', 'quit'];

function stopRecordedHere(row: AgentTerminalRow): row is AgentTerminalRow & {
  runId: string;
  stoppedBy: AgentTerminalStopper;
} {
  if (row.status !== 'stopped' || row.runId === null || row.stoppedBy === null) return false;
  return RECORDED_HERE.includes(row.stoppedBy);
}

async function recordTerminalStop(db: Db, row: AgentTerminalRow): Promise<void> {
  if (!stopRecordedHere(row)) return;
  const payload = {
    method: TERMINAL_STOP_AUDIT,
    params: { terminalId: row.id, name: redactText(row.name), by: row.stoppedBy },
  };
  await insertFinishedRunEntries(db, row.runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method: TERMINAL_STOP_AUDIT,
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

export async function recordTerminalStops(
  db: Db,
  rows: readonly AgentTerminalRow[],
): Promise<void> {
  for (const row of rows) {
    await recordTerminalStop(db, row).catch((error: unknown) =>
      console.error('Could not record a terminal stop in the audit', error),
    );
  }
}
