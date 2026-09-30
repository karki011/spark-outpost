import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { MEASURED_ARMS, type MeasuredArm } from '../../apps/server/src/orchestration/escalation.ts';
import { handoffPrompt } from '../../apps/server/src/orchestration/handoff.ts';
import { routeBuilder, type RouteContext } from '../../apps/server/src/orchestration/routing.ts';
import { ESCALATION_SCENARIOS, type EscalationScenario } from './escalation-scenarios.ts';
import { replayCandidates } from './replay-corpus.ts';

const { values } = parseArgs({ options: { out: { type: 'string' } } });

const NOW = new Date('2026-09-30T12:00:00Z');
const DEVELOPER_USD_PER_HOUR = 100;

interface ArmRow {
  scenario: string;
  arm: MeasuredArm;
  ruleWouldPick: boolean;
  model: string | null;
  rule: string;
  firstCallExtraUsd: number;
  tokensUsd: number;
  passRate: number;
  expectedUsd: number;
  handoffTokens: number | null;
}

function chat(scenario: EscalationScenario): RouteContext {
  return {
    routing: 'auto',
    chat: { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'medium' },
    providerEffort: null,
    candidates: replayCandidates,
    request: scenario.followUp,
    now: NOW,
  };
}

function facts(scenario: EscalationScenario, arm: MeasuredArm | null) {
  return {
    trivial: false,
    destructive: false,
    continues: true,
    ratings: scenario.ratings,
    arm,
    session: {
      pick: { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'high' },
      contextTokens: scenario.contextTokens,
      lastUsedAt: new Date(NOW.getTime() - 60_000),
    },
  };
}

function fakeHandoffTokens(scenario: EscalationScenario, arm: MeasuredArm): number | null {
  if (arm !== 'brief' && arm !== 'compact') return null;
  const history = scenario.warmUp.flatMap((text) => [
    { role: 'user' as const, content: text },
    { role: 'assistant' as const, content: `Done: ${text} ${'(details) '.repeat(80)}` },
  ]);
  const text = handoffPrompt({
    kind: arm,
    request: scenario.followUp,
    history,
    agreedPlan: null,
    changes: [{ path: 'src/ledger/totals.ts', additions: 120, deletions: 30 }],
    patch: `+${'const line = 1;\n+'.repeat(600)}`,
    openIssues: [],
    checkCommands: ['pnpm test'],
  });
  return Math.round(text.length / 4);
}

function armRow(scenario: EscalationScenario, arm: MeasuredArm, picked: string): ArmRow {
  const route = routeBuilder(chat(scenario), facts(scenario, arm));
  const pick = route.score!.pick;
  const repair = (scenario.repairMinutes / 60) * DEVELOPER_USD_PER_HOUR;
  return {
    scenario: scenario.id,
    arm,
    ruleWouldPick: picked === arm,
    model: route.pick.modelLabel,
    rule: route.rule,
    firstCallExtraUsd: pick.switchUsd,
    tokensUsd: pick.costUsd,
    passRate: pick.quality,
    expectedUsd: pick.costUsd + (1 - pick.quality) * repair,
    handoffTokens: fakeHandoffTokens(scenario, arm),
  };
}

const rows: ArmRow[] = [];
for (const scenario of ESCALATION_SCENARIOS) {
  const picked = routeBuilder(chat(scenario), facts(scenario, null)).escalation?.kind ?? 'stay';
  console.log(
    `\n${scenario.id} (${Math.round(scenario.contextTokens / 1000)}K): rules pick ${picked}`,
  );
  for (const arm of MEASURED_ARMS) {
    const row = armRow(scenario, arm, picked);
    rows.push(row);
    const handoff = row.handoffTokens === null ? '' : `, handoff ~${row.handoffTokens} tokens`;
    console.log(
      `  ${arm.padEnd(8)} ${String(row.model).padEnd(9)} first call +$${row.firstCallExtraUsd.toFixed(2)}, tokens $${row.tokensUsd.toFixed(2)}, prior pass ${(row.passRate * 100).toFixed(1)}%, expected $${row.expectedUsd.toFixed(2)} incl. ${scenario.repairMinutes} min repair${handoff}`,
    );
  }
}
console.log('\nDry run only: pass rates are the routing priors, not measurements.');
if (values.out) await writeFile(values.out, `${JSON.stringify(rows, null, 2)}\n`);
