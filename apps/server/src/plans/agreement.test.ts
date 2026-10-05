import { describe, expect, it } from 'vitest';
import { agreesByRule, planAgreementAction } from './agreement.ts';

describe('planAgreementAction', () => {
  it('saves a real plan the user accepts: both scores at 0.85 or more', () => {
    expect(planAgreementAction(0.93, 0.95)).toBe('save');
    expect(planAgreementAction(0.85, 0.85)).toBe('save');
  });

  it('offers when the plan is real but the acceptance is unsure, or the reverse', () => {
    expect(planAgreementAction(0.7, 0.95)).toBe('offer');
    expect(planAgreementAction(0.6, 0.6)).toBe('offer');
    expect(planAgreementAction(0.95, 0.84)).toBe('offer');
  });

  it('does nothing when the previous reply is not a plan, however clear the "ok"', () => {
    expect(planAgreementAction(0.7, 0.08)).toBe('none');
    expect(planAgreementAction(0.97, 0.59)).toBe('none');
  });

  it('does nothing when the message does not accept the plan', () => {
    expect(planAgreementAction(0.59, 0.95)).toBe('none');
  });

  it('does nothing without both Jev answers', () => {
    expect(planAgreementAction(0.95, null)).toBe('none');
    expect(planAgreementAction(0.95, undefined)).toBe('none');
    expect(planAgreementAction(0.95, Number.NaN)).toBe('none');
    expect(planAgreementAction(null, 0.95)).toBe('none');
    expect(planAgreementAction(undefined, undefined)).toBe('none');
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
