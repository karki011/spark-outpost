import { describe, expect, it } from 'vitest';
import {
  asksToKeep,
  confirmsRiskyFirst,
  DESTRUCTIVE_CARD_REASON,
  keepsByItself,
  MIGRATION_CARD_REASON,
  riskyChange,
} from './checkpoint-policy.ts';
import { riskyCard, RISKY_CARD_TITLE } from './checkpoint.ts';

const S10 =
  "Rename the `amount` column on `expenses` to `amount_cents` (it has always held cents). People have existing databases full of data, so add a new migration that keeps every row, and update the code and tests. Keep the API's JSON field names as they are.";

describe('risky work', () => {
  it('flags destructive work and migrations, not ordinary changes', () => {
    expect(riskyChange(true, 'tidy the README')).toBe(DESTRUCTIVE_CARD_REASON);
    expect(riskyChange(false, 'Add a migration for a tags table')).toBe(MIGRATION_CARD_REASON);
    expect(riskyChange(false, S10)).not.toBeNull();
    expect(riskyChange(false, 'Fix the typo in the spend summary')).toBeNull();
  });

  it('asks first at Ask before edits and Auto-edit, not at Full auto', () => {
    expect(confirmsRiskyFirst('balanced')).toBe(true);
    expect(confirmsRiskyFirst('hands-off')).toBe(true);
    expect(confirmsRiskyFirst('full-auto')).toBe(false);
  });

  it('offers Build it or Stop on the card', () => {
    const card = riskyCard(DESTRUCTIVE_CARD_REASON);
    expect(card).toMatchObject({ kind: 'plan', title: RISKY_CARD_TITLE });
    expect(card.options.map((option) => option.name)).toEqual(['Build it', 'Stop']);
  });
});

describe('keep card', () => {
  const settled = { checksFailing: false, criticUnsatisfied: false };

  it('always asks at Ask before edits when files changed', () => {
    expect(asksToKeep('balanced', 2, settled)).toBe(true);
    expect(asksToKeep('balanced', 0, settled)).toBe(false);
  });

  it('asks at Auto-edit only when checks fail or the Critic is not satisfied', () => {
    expect(asksToKeep('hands-off', 2, settled)).toBe(false);
    expect(keepsByItself('hands-off', 2)).toBe(true);
    expect(asksToKeep('hands-off', 2, { ...settled, checksFailing: true })).toBe(true);
    expect(asksToKeep('hands-off', 2, { ...settled, criticUnsatisfied: true })).toBe(true);
    expect(keepsByItself('hands-off', 0)).toBe(false);
  });

  it('never asks at Full auto, which keeps and ships', () => {
    expect(asksToKeep('full-auto', 2, { checksFailing: true, criticUnsatisfied: true })).toBe(
      false,
    );
    expect(keepsByItself('full-auto', 2)).toBe(false);
  });
});
