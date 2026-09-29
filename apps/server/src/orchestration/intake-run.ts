import { ruleAdvisor } from '../advisor/advice.ts';
import {
  askIntake,
  saveIntake,
  type IntakeDeps,
  type IntakeResult,
} from '../advisor/intake-recorder.ts';
import type { IntakeContext } from '../persistence/advice.ts';
import type { Append } from '../workflow/agent-turn.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { namedFiles } from './context.ts';
import { decideIntake, rulesAnswer, type CurrentTask, type IntakeDecisions } from './intake.ts';
import { ORCHESTRATION_JEV_TIMEOUT_MS } from './jev-calls.ts';
import { routeBuilder, type RouteContext } from './routing.ts';
import type { OrchestratorDeps } from './session.ts';

export function orchestrationJevDeps(deps: OrchestratorDeps): IntakeDeps | null {
  if (!deps.intake) return null;
  const own = deps.intake.deps.timeoutMs ?? ORCHESTRATION_JEV_TIMEOUT_MS;
  const timeoutMs = Math.min(own, deps.jevTimeoutMs ?? ORCHESTRATION_JEV_TIMEOUT_MS);
  return { ...deps.intake.deps, timeoutMs };
}

export function routeContext(input: RunInput, context: IntakeContext): RouteContext {
  return {
    routing: context.routing,
    chat: {
      provider: input.provider,
      model: input.settings.model,
      modelLabel: input.settings.modelLabel,
      effort: input.settings.effort,
    },
    providerEffort: context.defaultEfforts[input.provider] ?? null,
    candidates: context.candidates,
    request: input.userRequest,
  };
}

function soloDecisions(decisions: IntakeDecisions): IntakeDecisions {
  return { ...decisions, start: 'build', assume: false, review: false };
}

export async function runIntake(
  deps: OrchestratorDeps,
  input: RunInput,
  append: Append,
  current: CurrentTask | null,
  solo: boolean,
): Promise<{ intake: IntakeResult; decisions: IntakeDecisions }> {
  const extra = {
    firstMessage: input.history.length === 0,
    currentTask: current
      ? { previousRequest: current.previousRequest, summary: current.summary }
      : null,
  };
  const jevDeps = solo ? null : orchestrationJevDeps(deps);
  const asked = await askIntake(deps.db, jevDeps, input, extra);
  const jev = asked.outcome.status === 'answered' ? asked.outcome.intake : null;
  const decided = decideIntake(jev, {
    request: input.userRequest,
    mode: input.mode ?? 'chat',
    level: input.level,
    firstMessage: extra.firstMessage,
    namedFiles: namedFiles([input.userRequest]).length,
    currentTask: current,
  });
  const decisions = solo ? soloDecisions(decided) : decided;
  const pick = routeBuilder(routeContext(input, asked.context), decisions).pick;
  const rules = rulesAnswer(ruleAdvisor(asked.request), decisions, pick);
  const intake = await saveIntake(deps.db, input, append, asked, {
    rules,
    calls: decisions.calls,
  });
  return { intake, decisions };
}
