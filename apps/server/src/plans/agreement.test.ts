import { describe, expect, it } from 'vitest';
import { agreesByRule, planAgreementAction } from './agreement.ts';

describe('planAgreementAction', () => {
  it('saves at 0.85 or more, offers from 0.6, and otherwise does nothing', () => {
    expect(planAgreementAction(0.9)).toBe('save');
    expect(planAgreementAction(0.85)).toBe('save');
    expect(planAgreementAction(0.84)).toBe('offer');
    expect(planAgreementAction(0.6)).toBe('offer');
    expect(planAgreementAction(0.59)).toBe('none');
  });

  it('does nothing without a Jev answer', () => {
    expect(planAgreementAction(null)).toBe('none');
    expect(planAgreementAction(undefined)).toBe('none');
    expect(planAgreementAction(Number.NaN)).toBe('none');
  });
});

describe('agreesByRule', () => {
  it('matches short agreements', () => {
    for (const message of ['yes', 'Go ahead', 'sounds good, do it', "let's do it", 'do that']) {
      expect(agreesByRule(message)).toBe(true);
    }
  });

  it('does not match questions, refusals or long new requests', () => {
    expect(agreesByRule('why step 2?')).toBe(false);
    expect(agreesByRule('no, keep the old parser')).toBe(false);
    expect(agreesByRule(`yes ${'and also rewrite everything else '.repeat(5)}`)).toBe(false);
  });
});
