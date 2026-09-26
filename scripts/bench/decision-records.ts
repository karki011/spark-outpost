import type { Orchestration, OrchestrationDecision } from '../../packages/contracts/src/index.ts';
import type { ArchitectRecord, IntakeRecord, ParallelRecord, PickRecord } from './results.ts';

type Answer = Record<string, unknown>;

function numberOr(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function pickOf(value: unknown): PickRecord | null {
  if (!value || typeof value !== 'object') return null;
  const pick = value as { model?: unknown; effort?: unknown };
  return {
    model: typeof pick.model === 'string' ? pick.model : null,
    effort: typeof pick.effort === 'string' ? pick.effort : null,
  };
}

function find(orchestration: Orchestration, kind: string, role: string | null = null) {
  return orchestration.decisions.find(
    (decision) => decision.kind === kind && (role === null || decision.role === role),
  );
}

export function intakeRecord(orchestration: Orchestration): IntakeRecord | null {
  const intake = find(orchestration, 'intake');
  if (!intake) return null;
  const answer = intake.answer as Answer;
  const confidences = (answer.confidences ?? {}) as Record<string, unknown>;
  const note = answer.depthNote as { reason?: string } | undefined;
  return {
    scope: typeof answer.scope === 'string' ? answer.scope : null,
    scopeConfidence: numberOr(confidences.scope),
    complexity: numberOr(answer.complexity),
    complexityConfidence: numberOr(confidences.complexity),
    depthNote: note?.reason ?? null,
    intent: typeof answer.intent === 'string' ? answer.intent : null,
    intentConfidence: numberOr(confidences.intent),
  };
}

export function architectRecord(orchestration: Orchestration): ArchitectRecord | null {
  const route = find(orchestration, 'route', 'architect') as OrchestrationDecision | undefined;
  if (!route) return null;
  const answer = route.answer as Answer;
  const jevAnswered = route.jevStatus === 'answered';
  return {
    pick: pickOf(answer.pick) ?? { model: null, effort: null },
    routedBy: typeof answer.routedBy === 'string' ? answer.routedBy : route.applied,
    rule: typeof answer.rule === 'string' ? answer.rule : null,
    rulePick: pickOf(answer.rulePick),
    jevPick: jevAnswered ? pickOf(answer.autoWouldUse) : null,
    gate: route.gate?.decision ?? null,
    confidence: route.gate?.confidence ?? null,
  };
}

export function parallelRecord(orchestration: Orchestration): ParallelRecord | null {
  const parallel = find(orchestration, 'parallel');
  if (!parallel) return null;
  const answer = parallel.answer as Answer;
  const agreement = (answer.agreement ?? {}) as { asked?: number; agreed?: number };
  const pairs = (answer.pairs ?? []) as {
    steps: number[];
    rules: boolean;
    jev: { noul: number } | null;
    independent: boolean;
  }[];
  const sizes = (answer.sizes ?? []) as {
    step: number;
    rules: boolean;
    jev: { noul: number } | null;
    large: boolean;
  }[];
  return {
    chosen: (answer.chosen as number[][] | undefined) ?? [],
    rulesGroups: (answer.rulesGroups as number[][] | undefined) ?? [],
    asked: agreement.asked ?? 0,
    agreed: agreement.agreed ?? 0,
    applied: parallel.applied,
    jevStatus: parallel.jevStatus,
    steps: (answer.steps as ParallelRecord['steps']) ?? [],
    pairs: pairs.map((pair) => ({
      steps: pair.steps,
      rules: pair.rules,
      noul: pair.jev?.noul ?? null,
      independent: pair.independent,
    })),
    sizes: sizes.map((size) => ({
      step: size.step,
      rules: size.rules,
      noul: size.jev?.noul ?? null,
      large: size.large,
    })),
  };
}
