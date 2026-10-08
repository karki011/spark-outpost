import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Orchestration } from '../../../packages/contracts/src/index.ts';
import { createDb } from '../../../apps/server/src/persistence/db.ts';
import { doingPhrase, jevDoing } from '../../../apps/web/src/crew/jev-doing.ts';

const dir = process.env.FINAL_DIR ?? '';
const state = JSON.parse(readFileSync(join(dir, 'stack.json'), 'utf8')) as { databaseUrl: string };
const chat = JSON.parse(
  readFileSync(join(dir, 'evidence', `${process.argv[2]}.chat.json`), 'utf8'),
) as { conversationId: string };
const db = createDb(state.databaseUrl);
try {
  const { rows } = await db.query<{ created_at: Date; content: Orchestration }>(
    `SELECT e.created_at, e.payload->'content' AS content FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE r.conversation_id = $1 AND r.parent_run_id IS NULL AND e.type = 'ACTIVITY_SNAPSHOT'
       AND e.payload->>'activityType' = 'orchestration' ORDER BY e.created_at, e.seq`,
    [chat.conversationId],
  );
  let last = '';
  for (const row of rows) {
    const pieces = row.content.pieces?.pieces ?? [];
    const line = `${doingPhrase(jevDoing(row.content, null))} | phase=${row.content.phase} pieces=[${pieces.map((piece) => `${piece.key}:${piece.status}`).join(' ')}] crew=[${row.content.crew.map((member) => `${member.pieceKey ?? member.role}:${member.status}`).join(' ')}]`;
    if (line === last) continue;
    last = line;
    console.log(`${row.created_at.toISOString().slice(11, 23)} ${line}`);
  }
} finally {
  await db.end();
}
