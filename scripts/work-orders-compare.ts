import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HandoffOptions } from '../apps/server/src/orchestration/session.ts';
import {
  SCENARIOS,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Scenario,
} from '../apps/server/test/orchestration-support.ts';
import { createTestDb } from '../apps/server/test/support.ts';

const COMPLEX = SCENARIOS[3] as Scenario;

const CASES: readonly { id: string; scenario: Scenario }[] = [
  {
    id: 'short plan, one Builder',
    scenario: {
      ...COMPLEX,
      id: 'short',
      text: 'Split src/a.ts and src/b.ts into smaller modules. #build #orders #reads',
      depth: 'plan_execute',
      confidence: 0.65,
    },
  },
  {
    id: 'vague plan, Opus Architect',
    scenario: { ...COMPLEX, text: `${COMPLEX.text} #orders #reads` },
  },
];

const ARMS: readonly { id: string; handoff: HandoffOptions }[] = [
  { id: 'before (notes, fresh Builder)', handoff: { workOrders: false, planSession: false } },
  { id: 'after (work orders, plan session)', handoff: {} },
];

interface Row {
  arm: string;
  case: string;
  status: string;
  builders: number;
  continued: number;
  sentChars: number;
  fileReads: number;
  rereads: number;
  planSession: string;
}

interface BuilderRow {
  id: string;
  prompt: string;
  follow_up: string | null;
  file_reads: number | null;
  rereads: number | null;
  continued: boolean;
}

async function measure(arm: (typeof ARMS)[number], item: (typeof CASES)[number]): Promise<Row> {
  const t = await createTestDb();
  const root = await gitRepo();
  const store = mkdtempSync(join(tmpdir(), 'work-orders-compare-'));
  await connectProviders(t);
  const harness = startOrchestrator(t, jevFetch({ calls: [], scenario: item.scenario }), {
    sessions: store,
    handoff: arm.handoff,
  });
  try {
    const { conversationId, runId } = await startScenario(t, root, item.scenario, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    const { rows } = await t.db.query<BuilderRow>(
      `SELECT r.id, r.prompt, r.route->>'followUp' AS follow_up,
         (r.route->>'fileReads')::int AS file_reads, (r.route->>'rereads')::int AS rereads,
         EXISTS (SELECT 1 FROM run_events e WHERE e.run_id = r.id AND e.type = 'STEP_STARTED'
           AND e.payload->>'stepName' = 'Continued session') AS continued
       FROM runs r WHERE r.parent_run_id = $1 AND r.role = 'builder' ORDER BY r.created_at`,
      [runId],
    );
    const decision = orchestration.decisions.find(
      (entry) => entry.kind === 'route' && entry.role === 'builder',
    );
    return {
      arm: arm.id,
      case: item.id,
      status: orchestration.status,
      builders: rows.length,
      continued: rows.filter((row) => row.continued).length,
      sentChars: rows.reduce(
        (sum, row) => sum + (row.continued ? (row.follow_up ?? row.prompt) : row.prompt).length,
        0,
      ),
      fileReads: rows.reduce((sum, row) => sum + (row.file_reads ?? 0), 0),
      rereads: rows.reduce((sum, row) => sum + (row.rereads ?? 0), 0),
      planSession: /(same session|fresh Builder)[^·]*/.exec(decision?.summary ?? '')?.[0] ?? '—',
    };
  } finally {
    await harness.stop();
    await t.cleanup();
    await removeRepo(root);
    rmSync(store, { recursive: true, force: true });
  }
}

function table(rows: readonly Row[]): string {
  const head =
    '| Arm | Case | Status | Builders | Continued | Builder prompt chars sent | File reads | Re-reads | Plan session |';
  const lines = rows.map(
    (row) =>
      `| ${row.arm} | ${row.case} | ${row.status} | ${row.builders} | ${row.continued} | ${row.sentChars} | ${row.fileReads} | ${row.rereads} | ${row.planSession} |`,
  );
  return [head, '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...lines].join('\n');
}

const rows: Row[] = [];
for (const item of CASES) {
  for (const arm of ARMS) rows.push(await measure(arm, item));
}
console.log(table(rows));
console.log(
  [
    '',
    'Fake agent: prompt sizes, plan-session decisions and resumed sessions are real harness behaviour.',
    'Reads are scripted by the fake (#reads), so they show the recording, not a saving; tokens and cost are not measured.',
    'For live numbers run `pnpm bench:harness --modes harness --tasks H1,D2,P1 --work-orders off --plan-session off`, then again with both on, and compare the Builder tokens and file reads per agent.',
  ].join('\n'),
);
