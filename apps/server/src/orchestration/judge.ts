import { MAX_REPAIR_RETRIES, type AgentRole } from '@spark-outpost/contracts';
import { insertDecision, mergeRoute } from '../persistence/orchestrations.ts';
import { callJev } from './jev-calls.ts';
import {
  buildTransitionQuestions,
  parseTransitionAnswers,
  type TransitionFacts,
  type TransitionPick,
} from './jev-questions.ts';
import { changesSoFar } from './members.ts';
import type { Session } from './session.ts';
import { chooseTransition, type Judged } from './transition-choice.ts';

async function facts(s: Session, role: AgentRole): Promise<TransitionFacts> {
  const last = s.results.at(-1);
  const changes = await changesSoFar(s);
  const span = last?.role === 'builder' ? last.steps : [s.flow.stepIndex];
  const step = span.map((index) => s.flow.steps[index] ?? '').join('\n');
  return {
    task: s.input.userRequest,
    role,
    step: role === 'builder' ? step || null : null,
    outcome: last?.outcome === 'succeeded' ? 'succeeded' : 'failed',
    reply: last?.text ?? '',
    stepsLeft: Math.max(0, s.flow.steps.length - Math.max(...span) - 1),
    retriesLeft: Math.max(0, MAX_REPAIR_RETRIES - s.flow.retries),
    reviewed: s.flow.reviewed,
    verdict: role === 'critic' ? s.flow.verdict : null,
    findings: s.findings.length,
    filesChanged: changes.files.length,
    toolCalls: last?.toolCalls ?? 0,
  };
}

export async function judge(s: Session, role: AgentRole): Promise<Judged> {
  const last = s.results.at(-1);
  const known = await facts(s, role);
  const call = await callJev(s.jev, () => buildTransitionQuestions(known), s.control.signal);
  let pick: TransitionPick | null = null;
  let error = call.error;
  if (call.status === 'answered' && call.response) {
    try {
      pick = parseTransitionAnswers(known, call.response);
    } catch (parseError) {
      error = (parseError as Error).message;
    }
  }
  const { event, gate } = chooseTransition(s.flow, known.outcome, pick);
  const useJev = event.source === 'jev';
  const quality = useJev ? (pick?.quality ?? null) : null;
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'transition',
    childRunId: last?.runId ?? null,
    role,
    stepIndex: s.flow.stepIndex,
    jevStatus: pick ? 'answered' : call.status === 'answered' ? 'failed' : call.status,
    inputTokens: call.usage?.inputTokens ?? null,
    costUsd: call.usage?.costUsd ?? null,
    body: {
      summary: `${event.status.replaceAll('_', ' ')} · next ${event.next.replaceAll('_', ' ')}${quality !== null ? ` · quality ${quality.toFixed(1)} of 4` : ''}`,
      applied: useJev ? 'jev' : 'rules',
      gate,
      jevError: error,
      latencyMs: call.latencyMs,
      answer: { status: event.status, next: event.next, quality, jev: pick, rules: event.rules },
      state: call.asked?.state ?? null,
      questions: call.asked?.questions ?? null,
      answers: call.response?.answers ?? null,
    },
  });
  if (last && quality !== null) await mergeRoute(s.deps.db, last.runId, { quality });
  return event;
}
