import { describe, expect, it } from 'vitest';
import { proposedPlan } from './codex-plan.ts';

describe('proposedPlan', () => {
  it('reads the last proposed_plan block from a reply', () => {
    const text =
      'Draft:\n<proposed_plan>\nold\n</proposed_plan>\nBetter:\n<proposed_plan>\n# Plan\n1. Do it\n</proposed_plan>\nOK?';
    expect(proposedPlan(text)).toBe('# Plan\n1. Do it');
  });

  it('ignores replies without a finished block', () => {
    expect(proposedPlan('No plan here')).toBeNull();
    expect(proposedPlan('<proposed_plan>\nhalf')).toBeNull();
    expect(proposedPlan('<proposed_plan>  </proposed_plan>')).toBeNull();
  });
});
