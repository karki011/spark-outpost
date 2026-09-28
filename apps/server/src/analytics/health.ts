import type {
  CheckSummary,
  HealthComponent,
  HealthGrade,
  HealthScore,
  LoopSummary,
  VerdictCounts,
} from '@spark-outpost/contracts';

const MIN_COMPONENT_N = 5;
const FAST_WAIT_MS = 30_000;
const SLOW_WAIT_MS = 600_000;

const HEALTH_WEIGHTS = {
  outcomes: 40,
  checks: 20,
  corrections: 20,
  loops: 10,
  waits: 10,
} as const;

export interface HealthInputs {
  verdicts: VerdictCounts;
  settled: number;
  troubled: number;
  checks: CheckSummary;
  loops: LoopSummary;
  waits: number;
  medianWaitMs: number | null;
}

const clampPercent = (value: number) => Math.round(Math.min(100, Math.max(0, value)));

export function formatWait(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

function component(
  id: HealthComponent['id'],
  label: string,
  n: number,
  score: () => number,
  detail: string,
): HealthComponent {
  const enough = n >= MIN_COMPONENT_N;
  return {
    id,
    label,
    n,
    weight: HEALTH_WEIGHTS[id],
    score: enough ? clampPercent(score()) : null,
    detail: enough ? detail : `Not enough data yet (n=${n}).`,
  };
}

function healthComponents(input: HealthInputs): HealthComponent[] {
  const { good, bad, mixed } = input.verdicts;
  const rated = good + bad + mixed;
  const { checks, loops } = input;
  const waitScore = () => {
    const ms = input.medianWaitMs ?? 0;
    return (100 * (SLOW_WAIT_MS - ms)) / (SLOW_WAIT_MS - FAST_WAIT_MS);
  };
  return [
    component(
      'outcomes',
      'Good outcomes',
      rated,
      () => (100 * (good + mixed / 2)) / rated,
      `${good} good, ${mixed} mixed and ${bad} bad of ${rated} turns with a clear outcome.`,
    ),
    component(
      'checks',
      'Checks pass first time',
      checks.turns,
      () => (100 * checks.firstPassed) / checks.turns,
      `Checks passed on the first round in ${checks.firstPassed} of ${checks.turns} turns.`,
    ),
    component(
      'corrections',
      'No reverts or corrections',
      input.settled,
      () => 100 * (1 - input.troubled / input.settled),
      `${input.troubled} of ${input.settled} turns were reverted or corrected.`,
    ),
    component(
      'loops',
      'No retries or fix loops',
      loops.turns,
      () => 100 * (1 - loops.withRetries / loops.turns),
      `${loops.withRetries} of ${loops.turns} crew turns needed a retry or a fix round.`,
    ),
    component(
      'waits',
      'Quick approvals',
      input.waits,
      waitScore,
      input.medianWaitMs === null
        ? 'No approvals waited on you.'
        : `The median wait for your approval was ${formatWait(input.medianWaitMs)}.`,
    ),
  ];
}

export function healthGrade(score: number | null): HealthGrade {
  if (score === null) return 'not_enough_data';
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'fair';
  return 'needs_attention';
}

export function healthScore(input: HealthInputs): HealthScore {
  const components = healthComponents(input);
  const scored = components.filter((part) => part.score !== null);
  const outcomes = components.find((part) => part.id === 'outcomes');
  const weight = scored.reduce((sum, part) => sum + part.weight, 0);
  const score =
    outcomes?.score === null || weight === 0
      ? null
      : Math.round(scored.reduce((sum, part) => sum + part.score! * part.weight, 0) / weight);
  return { score, grade: healthGrade(score), components };
}
