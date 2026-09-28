/**
 * Re-score a saved dev-day run with the current score.ts, without re-running anything:
 *   node --import tsx scripts/e2e-live/dev-day/rescore-day.ts <run.json> <out-prefix>
 * Writes <out-prefix>.json and .md. A harness clarify card the developer answered, after which the
 * run replied in full, no longer counts as the turn's action (see harness-day.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ANSWERED_CLARIFY_REPLY_CHARS } from './harness-day.ts';
import { renderDayReport } from './report-day.ts';
import type { DayRun } from './run-day.ts';
import { scoreSession } from './score.ts';
import { SESSIONS } from './sessions.ts';

const [source, out] = process.argv.slice(2);
if (!source || !out) throw new Error('Usage: rescore-day.ts <run.json> <out-prefix>');
const run = JSON.parse(readFileSync(source, 'utf8')) as DayRun;
for (const record of run.records) {
  const session = SESSIONS.find((candidate) => candidate.id === record.session);
  if (!session) continue;
  const before = `${record.score.kind} ${record.score.passed ? 'pass' : 'FAIL'}`;
  if (
    record.arm === 'harness' &&
    record.evidence.clarifyCard &&
    session.policy !== 'stop-on-clarify' &&
    record.evidence.reply.trim().length >= ANSWERED_CLARIFY_REPLY_CHARS
  ) {
    record.evidence.clarifyCard = false;
  }
  record.score = scoreSession(session, record.evidence, run.rates);
  const after = `${record.score.kind} ${record.score.passed ? 'pass' : 'FAIL'}`;
  if (before !== after) console.log(`${record.session} ${record.arm}: ${before} → ${after}`);
}
writeFileSync(`${out}.json`, `${JSON.stringify(run, null, 2)}\n`);
writeFileSync(`${out}.md`, renderDayReport(run));
