import { PLAN_AGREED_ACT_AT, PLAN_AGREED_OFFER_AT } from '../advisor/policy.ts';

export type PlanAgreementAction = 'save' | 'offer' | 'none';

const AGREEMENT =
  /^\s*(yes|yep|yeah|ok|okay|sure|go ahead|go for it|do (that|it)|sounds good|looks good|lgtm|let'?s do (it|that)|approved?|proceed|ship it)\b/i;
const AGREEMENT_MAX_WORDS = 20;

export function agreesByRule(message: string): boolean {
  const words = message.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= AGREEMENT_MAX_WORDS && AGREEMENT.test(message);
}

type Score = number | null | undefined;

function atLeast(score: Score, threshold: number): boolean {
  return typeof score === 'number' && Number.isFinite(score) && score >= threshold;
}

export function planAgreementAction(agreed: Score, previousIsPlan: Score): PlanAgreementAction {
  const both = (threshold: number) =>
    atLeast(agreed, threshold) && atLeast(previousIsPlan, threshold);
  if (both(PLAN_AGREED_ACT_AT)) return 'save';
  if (both(PLAN_AGREED_OFFER_AT)) return 'offer';
  return 'none';
}
