import {
  buildVerdictQuestions,
  readVerdict,
  requirementLines,
  type VerdictReading,
} from '../advisor/verify-questions.ts';
import { callJev } from './jev-calls.ts';
import { changesForReview } from './member-prompts.ts';
import { DIFFS_OFF, recordAdvice } from './observe.ts';
import { escalatedBuilderPick } from './member-routes.ts';
import type { Session } from './session.ts';
import { ACT_AT } from '../advisor/policy.ts';
import { checksPhrase } from './critic-fix.ts';
import type { CascadeEvidence } from './flow-types.ts';
import { cascadeAction, type CascadeAction } from './cascade.ts';
import type { FlowEvent } from './transitions.ts';

const NOT_VERIFIED: FlowEvent = { type: 'verified', accepted: null, reasons: [] };

const ACTION_TEXT: Record<CascadeAction, string> = {
  escalate: 'rerun one tier up',
  ask: 'asked you',
  finish: 'finish',
};

function verdictSummary(reading: VerdictReading, action: CascadeAction, to: string | null): string {
  const answer =
    reading.verdict === null
      ? 'no valid answer'
      : `${reading.verdict} (${(reading.confidence ?? 0).toFixed(2)})`;
  const accepted = reading.accepted ? '' : ', not verified';
  const next = action === 'escalate' && to ? `rerun one tier up with ${to}` : ACTION_TEXT[action];
  return `Jev verdict: ${answer}${accepted} → ${next}`;
}

function builderRunId(s: Session): string | null {
  return s.results.findLast((result) => result.role === 'builder')?.runId ?? null;
}

export async function verifyChange(s: Session): Promise<FlowEvent> {
  const { patch } = await changesForReview(s);
  if (!patch.trim()) return NOT_VERIFIED;
  const plan = s.plan.map((entry) => entry.content);
  const requirements = requirementLines(s.input.userRequest, plan);
  const round = s.flow.verdicts + 1;
  if (!s.jevDiffs) {
    await recordAdvice(s, 'verify', builderRunId(s), null, DIFFS_OFF, {
      observation: false,
      round,
      requirements,
      would: null,
    });
    return NOT_VERIFIED;
  }
  const call = await callJev(
    s.jev,
    () =>
      buildVerdictQuestions({
        request: s.input.userRequest,
        plan,
        requirements,
        diff: patch,
        checks: s.checkLines,
      }),
    s.control.signal,
  );
  const reading = readVerdict(requirements, call.status === 'answered' ? call.response : null);
  const evidence: CascadeEvidence = {
    checksPass: checksPhrase(s.checkBodies) === 'checks pass',
    criticConcerns: s.flow.review.fixable.length > 0,
    confidentUnmet: reading.unmet.some((entry) => (entry.noul ?? 0) >= ACT_AT.verify),
  };
  const action = cascadeAction(reading.accepted, s.flow.escalated, evidence);
  const to = action === 'escalate' ? escalatedBuilderPick(s) : null;
  await recordAdvice(
    s,
    'verify',
    builderRunId(s),
    call,
    verdictSummary(reading, action, to?.modelLabel ?? to?.model ?? null),
    {
      observation: false,
      round,
      requirements,
      ...reading,
      would: reading.accepted ?? 'unverified',
      worst: reading.probabilities?.unsupported ?? null,
      action,
      evidence,
      escalateTo: to,
    },
    reading.accepted ? 'jev' : 'rules',
  );
  return { type: 'verified', accepted: reading.accepted, reasons: reading.reasons, evidence };
}
