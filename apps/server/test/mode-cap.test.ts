import { describe, expect, it } from 'vitest';
import { aboveLeadMode, modeAboveLead } from '../src/outposts/mode-cap.ts';

describe('the mode a sub-task chat may start in', () => {
  it('allows the same posture and any that asks more often', () => {
    expect(aboveLeadMode('auto', 'auto')).toBe(false);
    expect(aboveLeadMode('auto', 'edits')).toBe(false);
    expect(aboveLeadMode('full_access', 'asks')).toBe(false);
    expect(aboveLeadMode('read_only', 'read_only')).toBe(false);
    expect(aboveLeadMode('asks', 'denies')).toBe(false);
  });

  it('refuses a posture that asks less often than the lead', () => {
    expect(aboveLeadMode('read_only', 'asks')).toBe(true);
    expect(aboveLeadMode('asks', 'edits')).toBe(true);
    expect(aboveLeadMode('edits', 'auto')).toBe(true);
    expect(aboveLeadMode('auto', 'full_access')).toBe(true);
  });

  it('treats an unknown chat mode as the highest and an unknown lead mode as asking', () => {
    expect(aboveLeadMode('auto', 'unknown')).toBe(true);
    expect(aboveLeadMode('full_access', 'unknown')).toBe(false);
    expect(aboveLeadMode('unknown', 'asks')).toBe(false);
    expect(aboveLeadMode('unknown', 'edits')).toBe(true);
  });

  it('names both chats in the refusal', () => {
    expect(modeAboveLead('api', 'lead')).toContain('@api');
    expect(modeAboveLead('api', 'lead')).toContain("@lead's");
  });
});
