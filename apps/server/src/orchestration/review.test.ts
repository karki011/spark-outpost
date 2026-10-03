import { describe, expect, it } from 'vitest';
import { isResolvedFinding, openFindings, reviewFindings } from './review.ts';

const OPEN = '[bug] Plan adherence: the requested changelog line was not appended.';

describe('resolved Critic findings', () => {
  it('drops findings the Critic marks fixed, resolved or addressed', () => {
    const text = [
      'Findings:',
      '- [bug] Fixed: `formatMoney` now uses exact integer math, so large cent values keep their cents.',
      `- ${OPEN}`,
      '- [fixed] The one-line JSDoc comment is restored.',
      '- Resolved — the empty list no longer throws.',
      '- [bug] Now fixed: the parser rejects `((5.00)`.',
      '- [missing] Addressed.',
      'Verdict: concerns',
    ].join('\n');
    expect(openFindings(reviewFindings(text))).toEqual([OPEN]);
  });

  it('keeps open findings that only mention the words', () => {
    for (const finding of [
      OPEN,
      '[bug] Fixed-width columns overflow when a name has 40 characters.',
      '[bug] The fix for `parseCents` is not fixed: `-$5.00` still returns 500.',
      '[missing] The addressed envelope field is never written.',
    ]) {
      expect(isResolvedFinding(finding)).toBe(false);
    }
  });
});
