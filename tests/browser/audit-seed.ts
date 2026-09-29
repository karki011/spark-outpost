import { chainRows } from '../../apps/server/src/audit/hash-chain.ts';
import { openTestDb } from './database.ts';

const SESSION = 'sess_audit_1';

const MESSAGES: {
  direction: 'to_agent' | 'from_agent';
  kind: string;
  method: string | null;
  payload: unknown;
}[] = [
  {
    direction: 'to_agent',
    kind: 'request',
    method: 'session/prompt',
    payload: { jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { sessionId: SESSION } },
  },
  {
    direction: 'from_agent',
    kind: 'notification',
    method: 'session/update',
    payload: {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: SESSION,
        update: { sessionUpdate: 'tool_call', title: 'Read src/chat/Thread.tsx', kind: 'read' },
      },
    },
  },
  {
    direction: 'from_agent',
    kind: 'request',
    method: 'session/request_permission',
    payload: {
      jsonrpc: '2.0',
      id: 7,
      method: 'session/request_permission',
      params: { sessionId: SESSION, toolCall: { title: 'pnpm test' } },
    },
  },
  {
    direction: 'from_agent',
    kind: 'response',
    method: 'session/prompt',
    payload: { jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn' } },
  },
];

export interface SeededRun {
  runId: string;
  conversationId: string;
}

export async function seedAuditLog(): Promise<SeededRun> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ id: string; conversation_id: string; started_at: Date }>(
      'SELECT id, conversation_id, started_at FROM runs ORDER BY created_at DESC LIMIT 1',
    );
    const run = rows[0]!;
    const start = run.started_at.getTime();
    const hashed = chainRows(
      null,
      MESSAGES.map((message, index) => ({
        runId: run.id,
        at: new Date(start + index * 200).toISOString(),
        direction: message.direction,
        kind: message.kind,
        method: message.method,
        rpcId: null,
        sizeBytes: JSON.stringify(message.payload).length,
        truncated: false,
        payload: message.payload,
      })),
    );
    for (const row of hashed) {
      await db.query(
        `INSERT INTO run_protocol_log (run_id, seq, at, direction, kind, method, rpc_id,
           size_bytes, truncated, payload, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          row.runId,
          row.seq,
          row.at,
          row.direction,
          row.kind,
          row.method,
          row.rpcId,
          row.sizeBytes,
          row.truncated,
          JSON.stringify(row.payload),
          row.prevHash,
          row.hash,
        ],
      );
    }
    await db.query(
      `UPDATE runs SET cost_source = 'estimated', used_model = 'gpt-6-sol', used_effort = 'high',
         finished_at = started_at + interval '3 seconds', duration_ms = 3000 WHERE id = $1`,
      [run.id],
    );
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash,
         options, status, decided_by, decided_at, created_at)
       VALUES (gen_random_uuid(), $1, 'call-1', 'execute', 'pnpm test', '{}', 'h', '[]',
         'allowed', 'user', $2::timestamptz + interval '2 seconds',
         $2::timestamptz + interval '1 second')`,
      [run.id, run.started_at],
    );
    return { runId: run.id, conversationId: run.conversation_id };
  } finally {
    await db.end();
  }
}

export async function tamperAuditLog(runId: string): Promise<void> {
  const db = openTestDb();
  try {
    await db.query(
      `UPDATE run_protocol_log SET payload = jsonb_set(payload, '{params,sessionId}', '"forged"')
       WHERE run_id = $1 AND seq = 2`,
      [runId],
    );
  } finally {
    await db.end();
  }
}
