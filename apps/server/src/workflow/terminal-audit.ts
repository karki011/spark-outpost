import type { AgentTerminalStopper } from '@spark-outpost/contracts';
import { redactText, redactValue } from '../audit/redact.ts';
import type { AgentTerminalRow } from '../persistence/agent-terminals.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import type { ProtocolObserver } from '../providers/provider.ts';
import type { SparkCommandAudit } from './command-gate.ts';

export const TERMINAL_START_AUDIT = 'spark/terminal_start';
export const TERMINAL_STOP_AUDIT = 'spark/terminal_stop';

export interface TerminalStartFacts extends SparkCommandAudit {
  terminalId: string | null;
  approvalId: string | null;
}

export function auditTerminalStart(
  audit: ProtocolObserver | undefined,
  facts: TerminalStartFacts,
): void {
  const started = facts.terminalId !== null;
  const unreviewed = started && facts.unreviewed;
  audit?.message(
    'harness',
    { method: TERMINAL_START_AUDIT, params: redactValue({ ...facts, unreviewed }) },
    unreviewed ? { unreviewed: true } : undefined,
  );
}

interface TerminalStopFacts {
  terminalId: string;
  name: string;
  by: AgentTerminalStopper;
}

function stopFacts(row: AgentTerminalRow, by: AgentTerminalStopper): TerminalStopFacts {
  return { terminalId: row.id, name: redactText(row.name), by };
}

export function auditTerminalStop(
  audit: ProtocolObserver | undefined,
  row: AgentTerminalRow,
  by: AgentTerminalStopper,
): void {
  audit?.message('harness', { method: TERMINAL_STOP_AUDIT, params: stopFacts(row, by) });
}

export async function recordTerminalStop(
  db: Db,
  row: AgentTerminalRow,
  by: AgentTerminalStopper,
): Promise<void> {
  if (row.runId === null) return;
  const payload = { method: TERMINAL_STOP_AUDIT, params: stopFacts(row, by) };
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
