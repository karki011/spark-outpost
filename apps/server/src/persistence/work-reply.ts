export const REPLY_AS_STORED = 'COALESCE(m.final_reply, m.content)';

export function workReply(runId: string, text: string = REPLY_AS_STORED): string {
  return `SELECT ${text} AS text FROM messages m
    WHERE m.run_id = ${runId} AND m.role = 'assistant' ORDER BY m.created_at, m.id LIMIT 1`;
}
