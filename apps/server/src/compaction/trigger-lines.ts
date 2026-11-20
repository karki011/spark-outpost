import type { CompactTrigger, NaturalBreak } from './policy.ts';

export const NATURAL_BREAK_LINE = 'Context compacted at a natural break';
export const THRESHOLD_LINE = 'Context compacted at the compaction point';

const BREAK_REASONS: Record<NaturalBreak, string> = {
  'plan-done': 'the last turn finished its plan',
  'pull-request': 'the last turn opened a pull request',
};

export function breakReason(why: NaturalBreak): string {
  return BREAK_REASONS[why];
}

export function triggerLine(trigger: CompactTrigger, percent: number): string {
  if (trigger.kind === 'break') {
    return `${NATURAL_BREAK_LINE}: ${breakReason(trigger.why)} (${percent}% full)`;
  }
  return `${THRESHOLD_LINE} (${percent}% full)`;
}

export function cardTriggerText(trigger: CompactTrigger): string {
  if (trigger.kind === 'threshold') return '';
  return ` ${breakReason(trigger.why).replace(/^the/, 'The')}, a natural break to compact.`;
}
