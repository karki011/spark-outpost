import {
  AGENT_TERMINAL_STORED_CHARS,
  agentTerminalEndState,
  agentTerminalLive,
  outputTail,
  type AgentTerminalStopper,
} from '@spark-outpost/contracts';
import {
  AGENT_TERMINAL_COLUMNS,
  AGENT_TERMINAL_LIVE,
  agentTerminalFromDb,
  agentTerminalRow,
  type AgentTerminalDbRow,
  type AgentTerminalRow,
} from './agent-terminals.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';

async function askStop(
  db: Queryable,
  where: string,
  target: string,
  by: AgentTerminalStopper,
): Promise<AgentTerminalRow[]> {
  const { rows } = await db.query<AgentTerminalDbRow>(
    `UPDATE agent_terminals SET wanted = 'stopped', stopped_by = $2
     WHERE ${where} AND ${AGENT_TERMINAL_LIVE} AND wanted = 'running'
     RETURNING ${AGENT_TERMINAL_COLUMNS}`,
    [target, by],
  );
  return rows.map(agentTerminalFromDb);
}

export async function askAgentTerminalStop(
  db: Queryable,
  id: string,
  by: AgentTerminalStopper,
): Promise<AgentTerminalRow | null> {
  await askStop(db, 'id = $1', id, by);
  return agentTerminalRow(db, id);
}

export function stopRunAgentTerminals(
  db: Queryable,
  runId: string,
  by: AgentTerminalStopper = 'turn_stopped',
): Promise<AgentTerminalRow[]> {
  return askStop(db, 'run_id = $1', runId, by);
}

export function stopChatAgentTerminals(
  db: Queryable,
  conversationId: string,
  by: AgentTerminalStopper = 'chat_removed',
): Promise<AgentTerminalRow[]> {
  return askStop(db, 'conversation_id = $1', conversationId, by);
}

export async function markAgentTerminalRunning(
  db: Queryable,
  id: string,
  pid: number | null,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE agent_terminals SET status = 'running', pid = $2 WHERE id = $1 AND status = 'starting'`,
    [id, pid],
  );
  return rowCount === 1;
}

export async function saveAgentTerminalOutput(
  db: Queryable,
  id: string,
  output: string,
  outputChars: number,
): Promise<void> {
  await db.query(
    `UPDATE agent_terminals SET output = $2, output_chars = $3
     WHERE id = $1 AND ${AGENT_TERMINAL_LIVE} AND output_chars <= $3`,
    [id, outputTail(output, AGENT_TERMINAL_STORED_CHARS), outputChars],
  );
}

export interface AgentTerminalEnd {
  exitCode: number | null;
  spawned: boolean;
  output: string;
  outputChars: number;
}

export async function endAgentTerminal(
  db: Db,
  id: string,
  end: AgentTerminalEnd,
): Promise<AgentTerminalRow | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<AgentTerminalDbRow>(
      `SELECT ${AGENT_TERMINAL_COLUMNS} FROM agent_terminals WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const current = rows[0] ? agentTerminalFromDb(rows[0]) : null;
    if (!current || !agentTerminalLive(current.status)) return current;
    const status = agentTerminalEndState({ ...end, wanted: current.wanted });
    const updated = await client.query<AgentTerminalDbRow>(
      `UPDATE agent_terminals
       SET status = $2, exit_code = $3, pid = NULL, ended_at = now(), output = $4,
         output_chars = GREATEST(output_chars, $5)
       WHERE id = $1 RETURNING ${AGENT_TERMINAL_COLUMNS}`,
      [
        id,
        status,
        end.exitCode,
        outputTail(end.output, AGENT_TERMINAL_STORED_CHARS),
        end.outputChars,
      ],
    );
    return agentTerminalFromDb(updated.rows[0]!);
  });
}

export type AgentTerminalsGone = 'startup' | 'quit';

export async function endLiveAgentTerminals(
  db: Queryable,
  workspaceId: string,
  why: AgentTerminalsGone,
): Promise<AgentTerminalRow[]> {
  const { rows } = await db.query<AgentTerminalDbRow>(
    `UPDATE agent_terminals
     SET status = $2, wanted = 'stopped', stopped_by = COALESCE(stopped_by, $3::text), pid = NULL,
       ended_at = now()
     WHERE workspace_id = $1 AND ${AGENT_TERMINAL_LIVE}
     RETURNING ${AGENT_TERMINAL_COLUMNS}`,
    [workspaceId, why === 'quit' ? 'stopped' : 'interrupted', why === 'quit' ? 'quit' : null],
  );
  return rows.map(agentTerminalFromDb);
}
