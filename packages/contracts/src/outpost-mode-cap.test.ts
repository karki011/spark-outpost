import { describe, expect, it } from 'vitest';
import { aboveLeadMode, chatModeRank, leadModeLimit } from './outpost-mode-cap.ts';

describe('the mode cap between a lead chat and a chat it proposes', () => {
  it('lets a proposed chat ask as often as the lead or more often, never less', () => {
    expect(aboveLeadMode('asks', 'read_only')).toBe(false);
    expect(aboveLeadMode('asks', 'asks')).toBe(false);
    expect(aboveLeadMode('asks', 'edits')).toBe(true);
    expect(aboveLeadMode('edits', 'auto')).toBe(true);
    expect(aboveLeadMode('full_access', 'full_access')).toBe(false);
  });

  it('treats a mode it cannot place as the most open for a chat and as asking for a lead', () => {
    expect(aboveLeadMode('auto', 'unknown')).toBe(true);
    expect(aboveLeadMode('unknown', 'edits')).toBe(true);
    expect(aboveLeadMode('unknown', 'asks')).toBe(false);
  });

  it('ranks a chat no higher than the limit of a lead in the same mode', () => {
    for (const posture of [
      'read_only',
      'asks',
      'denies',
      'edits',
      'auto',
      'full_access',
    ] as const) {
      expect(chatModeRank(posture)).toBeLessThanOrEqual(leadModeLimit(posture));
    }
    expect(chatModeRank('unknown')).toBeGreaterThan(leadModeLimit('unknown'));
  });
});
