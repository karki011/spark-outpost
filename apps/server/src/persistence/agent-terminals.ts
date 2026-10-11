import {
  agentTerminalSchema,
  type AgentTerminal,
  type AgentTerminalDecider,
  type AgentTerminalState,
  type AgentTerminalStopper,
  type AgentTerminalWanted,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface AgentTerminalRow {
  id: string;
  workspaceId: string;
  conversationId: string;
  runId: string | null;
  toolCallId: string | null;
  provider: string;
  name: string;
  command: string;
  cwd: string;
  wanted: AgentTerminalWanted;
  status: AgentTerminalState;
  exitCode: number | null;
  pid: number | null;
  decidedBy: AgentTerminalDecider;
  approvalId: string | null;
  stoppedBy: AgentTerminalStopper | null;
  outputChars: number;
  textOffset: number | null;
  textBefore: string | null;
  textHeld: number | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface AgentTerminalDbRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  run_id: string | null;
  tool_call_id: string | null;
  provider: string;
  name: string;
  command: string;
  cwd: string;
  wanted: AgentTerminalWanted;
  status: AgentTerminalState;
  exit_code: number | null;
  pid: number | null;
  decided_by: AgentTerminalDecider;
  approval_id: string | null;
  stopped_by: AgentTerminalStopper | null;
  output_chars: string;
  text_offset: number | null;
  text_before: string | null;
  text_held: number | null;
  started_at: Date;
  ended_at: Date | null;
}

export const AGENT_TERMINAL_COLUMNS = `id, workspace_id, conversation_id, run_id, tool_call_id, provider, name, command,
  cwd, wanted, status, exit_code, pid, decided_by, approval_id, stopped_by, output_chars,
  text_offset, text_before, text_held, started_at, ended_at`;

export const AGENT_TERMINAL_LIVE = `status IN ('starting', 'running')`;

export function agentTerminalFromDb(row: AgentTerminalDbRow): AgentTerminalRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    provider: row.provider,
    name: row.name,
    command: row.command,
    cwd: row.cwd,
    wanted: row.wanted,
    status: row.status,
    exitCode: row.exit_code,
    pid: row.pid,
    decidedBy: row.decided_by,
    approvalId: row.approval_id,
    stoppedBy: row.stopped_by,
    outputChars: Number(row.output_chars),
    textOffset: row.text_offset,
    textBefore: row.text_before,
    textHeld: row.text_held,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function toAgentTerminal(row: AgentTerminalRow): AgentTerminal {
  return agentTerminalSchema.parse({
    id: row.id,
    conversationId: row.conversationId,
    runId: row.runId,
    provider: row.provider,
    name: row.name,
    command: row.command,
    cwd: row.cwd,
    state: row.status,
    exitCode: row.exitCode,
    decidedBy: row.decidedBy,
    stoppedBy: row.stoppedBy,
    outputChars: row.outputChars,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    textOffset: row.textOffset,
    textBefore: row.textBefore,
    textHeld: row.textHeld,
  });
}

export interface NewAgentTerminal {
  runId: string;
  toolCallId: string | null;
  name: string;
  command: string;
  cwd: string;
  decidedBy: AgentTerminalDecider;
  approvalId: string | null;
  textOffset: number | null;
  textBefore: string | null;
  textHeld: number | null;
}

export interface StartedAgentTerminal {
  row: AgentTerminalRow;
  created: boolean;
}

async function startedBefore(
  db: Queryable,
  runId: string,
  toolCallId: string | null,
): Promise<AgentTerminalRow | null> {
  if (toolCallId === null) return null;
  const { rows } = await db.query<AgentTerminalDbRow>(
    `SELECT ${AGENT_TERMINAL_COLUMNS} FROM agent_terminals WHERE run_id = $1 AND tool_call_id = $2`,
    [runId, toolCallId],
  );
  return rows[0] ? agentTerminalFromDb(rows[0]) : null;
}

export async function startAgentTerminal(
  db: Queryable,
  terminal: NewAgentTerminal,
): Promise<StartedAgentTerminal | null> {
  const { rows } = await db.query<AgentTerminalDbRow>(
    `INSERT INTO agent_terminals
       (id, workspace_id, conversation_id, run_id, tool_call_id, provider, name, command, cwd,
        decided_by, approval_id, text_offset, text_before, text_held)
     SELECT $1, c.workspace_id, c.id, r.id, $3, r.provider, $4, $5, $6, $7,
       (SELECT id FROM approvals WHERE id = $8), $9, $10, $11
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE r.id = $2
     ON CONFLICT (run_id, tool_call_id) WHERE tool_call_id IS NOT NULL DO NOTHING
     RETURNING ${AGENT_TERMINAL_COLUMNS}`,
    [
      newId(),
      terminal.runId,
      terminal.toolCallId,
      terminal.name,
      terminal.command,
      terminal.cwd,
      terminal.decidedBy,
      terminal.approvalId,
      terminal.textOffset,
      terminal.textBefore,
      terminal.textHeld,
    ],
  );
  if (rows[0]) return { row: agentTerminalFromDb(rows[0]), created: true };
  const existing = await startedBefore(db, terminal.runId, terminal.toolCallId);
  return existing ? { row: existing, created: false } : null;
}

export async function agentTerminalRow(
  db: Queryable,
  id: string,
): Promise<AgentTerminalRow | null> {
  const { rows } = await db.query<AgentTerminalDbRow>(
    `SELECT ${AGENT_TERMINAL_COLUMNS} FROM agent_terminals WHERE id = $1`,
    [id],
  );
  return rows[0] ? agentTerminalFromDb(rows[0]) : null;
}

export async function chatAgentTerminals(
  db: Queryable,
  conversationId: string,
): Promise<AgentTerminalRow[]> {
  const { rows } = await db.query<AgentTerminalDbRow>(
    `SELECT ${AGENT_TERMINAL_COLUMNS} FROM agent_terminals WHERE conversation_id = $1 ORDER BY started_at, id`,
    [conversationId],
  );
  return rows.map(agentTerminalFromDb);
}

export async function liveAgentTerminals(
  db: Queryable,
  workspaceId: string,
): Promise<AgentTerminalRow[]> {
  const { rows } = await db.query<AgentTerminalDbRow>(
    `SELECT ${AGENT_TERMINAL_COLUMNS} FROM agent_terminals WHERE workspace_id = $1 AND ${AGENT_TERMINAL_LIVE}
     ORDER BY started_at, id`,
    [workspaceId],
  );
  return rows.map(agentTerminalFromDb);
}

export async function agentTerminalOutput(
  db: Queryable,
  conversationId: string,
  id: string,
): Promise<{ output: string; outputChars: number } | null> {
  const { rows } = await db.query<{ output: string; output_chars: string }>(
    'SELECT output, output_chars FROM agent_terminals WHERE id = $1 AND conversation_id = $2',
    [id, conversationId],
  );
  const row = rows[0];
  return row ? { output: row.output, outputChars: Number(row.output_chars) } : null;
}
