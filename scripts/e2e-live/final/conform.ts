import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { storedEvents, verifyStream } from '../../../apps/server/test/agui-conformance.ts';
import { connect, DIR, rows } from './lib.ts';

const ctx = connect();
const wanted = process.argv[2] ?? '';
const report: Record<string, { runs: number; events: number; problems: string[] }> = {};
for (const file of readdirSync(join(DIR, 'evidence')).filter((name) =>
  name.endsWith('.chat.json'),
)) {
  const chat = JSON.parse(readFileSync(join(DIR, 'evidence', file), 'utf8')) as {
    label: string;
    conversationId: string;
  };
  if (wanted && !chat.label.startsWith(wanted)) continue;
  const runs = await rows<{ id: string; role: string | null; status: string }>(
    ctx,
    'SELECT id, role, status FROM runs WHERE conversation_id = $1 ORDER BY created_at',
    [chat.conversationId],
  );
  const entry = { runs: runs.length, events: 0, problems: [] as string[] };
  for (const run of runs) {
    try {
      const events = await storedEvents(ctx.db, run.id);
      entry.events += events.length;
      if (events.length > 0) await verifyStream(events);
    } catch (error) {
      entry.problems.push(
        `${run.role ?? 'turn'} ${run.status} ${run.id}: ${(error as Error).message.slice(0, 300)}`,
      );
    }
  }
  report[chat.label] = entry;
  console.log(chat.label, JSON.stringify(entry));
}
writeFileSync(join(DIR, 'evidence', 'agui-conformance.json'), JSON.stringify(report, null, 1));
await ctx.db.end();
