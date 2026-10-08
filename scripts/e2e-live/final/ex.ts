import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from '../../../apps/server/src/persistence/db.ts';

const dir = process.env.FINAL_DIR ?? '';
const label = process.argv[2]!;
const roles = (process.argv[3] ?? 'coordinator').split(',');
const state = JSON.parse(readFileSync(join(dir, 'stack.json'), 'utf8')) as { databaseUrl: string };
const chat = JSON.parse(readFileSync(join(dir, 'evidence', `${label}.chat.json`), 'utf8')) as {
  conversationId: string;
};
const db = createDb(state.databaseUrl);
const out = join(dir, 'evidence', 'prompts');
mkdirSync(out, { recursive: true });

interface Row {
  id: string;
  role: string | null;
  provider: string;
  agent_label: string | null;
}

function promptText(payload: unknown): string {
  const blocks = (payload as { params?: { prompt?: { type: string; text?: string }[] } }).params
    ?.prompt;
  return (blocks ?? []).map((block) => block.text ?? `[${block.type}]`).join('\n');
}

try {
  const runs = (
    await db.query<Row>(
      `SELECT id, role, provider, agent_label FROM runs WHERE conversation_id = $1 ORDER BY created_at`,
      [chat.conversationId],
    )
  ).rows;
  const counts = new Map<string, number>();
  for (const run of runs) {
    const role = run.role ?? 'turn';
    const index = (counts.get(role) ?? 0) + 1;
    counts.set(role, index);
    const events = (
      await db.query<{ type: string; n: number }>(
        `SELECT type, count(*)::int AS n FROM run_events WHERE run_id = $1
         AND type IN ('REASONING_MESSAGE_CONTENT','REASONING_START','TEXT_MESSAGE_CONTENT') GROUP BY 1`,
        [run.id],
      )
    ).rows;
    const thought = (
      await db.query<{ n: number; chars: number }>(
        `SELECT count(*)::int AS n, coalesce(sum(length(payload->'params'->'update'->'content'->>'text')),0)::int AS chars
         FROM run_protocol_log WHERE run_id = $1 AND method = 'session/update'
         AND payload->'params'->'update'->>'sessionUpdate' = 'agent_thought_chunk'`,
        [run.id],
      )
    ).rows[0]!;
    const actual = (
      await db.query<{ model: string | null; how: string | null }>(
        `SELECT (SELECT string_agg(DISTINCT payload->'params'->'update'->'_meta'->>'_claude/model', ',')
           FROM run_protocol_log WHERE run_id = $1 AND method = 'session/update') AS model,
         (SELECT string_agg(method, ',' ORDER BY seq) FROM run_protocol_log WHERE run_id = $1
           AND direction = 'to_agent' AND method IN ('session/new','session/resume','session/load')) AS how`,
        [run.id],
      )
    ).rows[0]!;
    const sets = (
      await db.query<{ v: string }>(
        `SELECT (payload->'params'->>'configId') || '=' || (payload->'params'->>'value') AS v
         FROM run_protocol_log WHERE run_id = $1 AND direction = 'to_agent'
         AND method = 'session/set_config_option' ORDER BY seq`,
        [run.id],
      )
    ).rows.map((row) => row.v);
    console.log(`   ${actual.how ?? '-'} set[${sets.join(' ')}] ran on ${actual.model ?? '-'}`);
    console.log(
      `${role}-${index} ${run.provider} ${run.agent_label ?? ''} | thought chunks ${thought.n} (${thought.chars} chars) | ${events.map((event) => `${event.type}=${event.n}`).join(' ')}`,
    );
    if (!roles.includes(role)) continue;
    const prompts = (
      await db.query<{ payload: unknown; truncated: boolean }>(
        `SELECT payload, truncated FROM run_protocol_log WHERE run_id = $1 AND direction = 'to_agent'
         AND method = 'session/prompt' ORDER BY seq`,
        [run.id],
      )
    ).rows;
    const reply = (
      await db.query<{ text: string | null }>(
        `SELECT string_agg(payload->'params'->'update'->'content'->>'text', '' ORDER BY seq) AS text
         FROM run_protocol_log WHERE run_id = $1 AND method = 'session/update'
         AND payload->'params'->'update'->>'sessionUpdate' = 'agent_message_chunk'`,
        [run.id],
      )
    ).rows[0]!;
    const base = join(out, `${label}.${role}-${index}`);
    writeFileSync(
      `${base}.prompt.txt`,
      prompts
        .map((row) => `${row.truncated ? '[TRUNCATED IN LOG]\n' : ''}${promptText(row.payload)}`)
        .join('\n\n=====\n\n'),
    );
    writeFileSync(`${base}.reply.txt`, reply.text ?? '');
  }
} finally {
  await db.end();
}
