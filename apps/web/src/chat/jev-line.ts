import { categoryLabel, type AdviceSummary, type IntakeCall } from '@spark-outpost/contracts';

type Calls = Record<string, IntakeCall>;

interface Treatment {
  call: IntakeCall;
  jev: string;
  rules: string;
}

function treated(call: IntakeCall, as: string): Treatment {
  return { call, jev: `Jev: treated as ${as}`, rules: `rules treated it as ${as}` };
}

function treatment(calls: Calls): Treatment | null {
  const { plan_only: planOnly, review, vague, question, plan } = calls;
  if (planOnly?.value) return treated(planOnly, 'a plan request');
  if (review?.value && question?.value) return treated(review, 'a review');
  if (vague?.value) {
    return { call: vague, jev: 'Jev: found it unclear', rules: 'rules found it unclear' };
  }
  if (question?.value) return treated(question, 'a question');
  if (plan?.value) return treated(plan, 'a build, plan first');
  return question ? treated(question, 'a build') : null;
}

function answeredLine(advice: AdviceSummary): string {
  const calls = advice.calls ?? {};
  if (calls.change?.source === 'user') return 'Jev answered · you chose to build';
  const found = treatment(calls);
  if (found) return found.call.source === 'jev' ? found.jev : `Jev answered · ${found.rules}`;
  const intent = advice.jev?.intent;
  return intent ? `Jev: read it as ${categoryLabel(intent)}` : 'Jev answered';
}

function withoutStop(text: string): string {
  return text.trim().replace(/\.$/, '');
}

export function jevLine(advice: AdviceSummary | undefined): string | null {
  if (!advice) return null;
  switch (advice.jevStatus) {
    case 'answered':
      return answeredLine(advice);
    case 'not_connected':
      return 'Jev not connected';
    case 'timed_out':
      return 'Jev timed out · rules decided';
    case 'failed':
      return 'Jev failed · rules decided';
    case 'not_asked':
      return advice.jevError ? `Jev skipped: ${withoutStop(advice.jevError)}` : 'Jev skipped';
  }
}
