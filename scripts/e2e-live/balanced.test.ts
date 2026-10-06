import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type Approval } from '../../packages/contracts/src/index.ts';
import { balancedChoice } from './balanced.ts';

function keepCard(fixName: string | null, reason: string): Approval {
  return {
    kind: 'accept',
    reason,
    autoContinueAt: null,
    options: [
      { optionId: CHECKPOINT_OPTION.keep, name: 'Keep', kind: 'allow_once' },
      ...(fixName
        ? [{ optionId: CHECKPOINT_OPTION.fixFindings, name: fixName, kind: 'allow_once' as const }]
        : []),
      { optionId: CHECKPOINT_OPTION.revert, name: 'Revert', kind: 'reject_once' },
    ],
    payload: {},
  } as unknown as Approval;
}

describe('the Balanced user on the keep card', () => {
  it('lets one round fix the findings, then keeps', () => {
    const first = keepCard('Fix these findings', 'The AI review found 1 correctness finding.');
    expect(balancedChoice(first).optionId).toBe(CHECKPOINT_OPTION.fixFindings);
    const again = keepCard('Fix again', 'Still concerns after 1 round: …');
    expect(balancedChoice(again).optionId).toBe(CHECKPOINT_OPTION.keep);
  });
});
