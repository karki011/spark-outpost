import type { Verdict } from '../advisor/verify-questions.ts';
import type { CascadeEvidence } from './flow-types.ts';

export type CascadeAction = 'escalate' | 'ask' | 'finish';

function ownChecksSettleIt(evidence: CascadeEvidence | undefined): boolean {
  return (
    evidence !== undefined &&
    evidence.checksPass &&
    !evidence.criticConcerns &&
    !evidence.confidentUnmet
  );
}

export function cascadeAction(
  accepted: Verdict | null,
  escalated: boolean,
  evidence?: CascadeEvidence,
): CascadeAction {
  if (escalated) return 'finish';
  if (accepted === 'unsupported') return ownChecksSettleIt(evidence) ? 'ask' : 'escalate';
  if (accepted === 'declined') return 'ask';
  return 'finish';
}

export const ESCALATED_NOTE =
  'The Builder ran again one tier up after Jev could not confirm the first attempt did everything asked.';

export const DECLINED_REASON =
  'Jev could not confirm the change does what you asked: the diff does not settle it, or the work looks refused or left unfinished on purpose.';

export const UNCONFIRMED_REASON =
  "Jev could not confirm the change does everything you asked, but it named nothing missing for sure, the project's checks pass and the AI review raised no concerns, so Spark didn't rerun the Builder.";
