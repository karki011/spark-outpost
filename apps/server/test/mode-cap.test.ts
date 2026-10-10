import { describe, expect, it } from 'vitest';
import { aboveLeadMode } from '@spark-outpost/contracts';
import {
  modeAboveLead,
  proposalAboveLead,
  proposedAboveOwnMode,
  userChoseMode,
} from '../src/outposts/mode-cap.ts';

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

describe("whose choice a starting chat's mode is", () => {
  it("is the lead chat's when the start request keeps the mode the draft proposed", () => {
    expect(userChoseMode('agent-full-access', 'agent-full-access')).toBe(false);
    expect(userChoseMode(null, null)).toBe(false);
  });

  it("is the user's when the start request carries a different mode", () => {
    expect(userChoseMode('ask-every-action', 'agent-full-access')).toBe(true);
    expect(userChoseMode(null, 'agent-full-access')).toBe(true);
    expect(userChoseMode('agent-full-access', null)).toBe(true);
  });
});

describe('the modes a lead chat may propose in a draft', () => {
  it('accepts proposals that ask at least as often as the lead', () => {
    const chats = [
      { handle: 'api', posture: 'edits' as const },
      { handle: 'web', posture: 'asks' as const },
    ];
    expect(proposalAboveLead('edits', chats)).toBeNull();
    expect(proposalAboveLead('auto', [])).toBeNull();
  });

  it('refuses the first proposal that asks less often than the lead, by handle', () => {
    const chats = [
      { handle: 'api', posture: 'asks' as const },
      { handle: 'web', posture: 'full_access' as const },
      { handle: 'docs', posture: 'auto' as const },
    ];
    expect(proposalAboveLead('asks', chats)).toBe(proposedAboveOwnMode('web'));
    expect(proposedAboveOwnMode('web')).toContain('@web');
  });

  it('refuses a proposed mode Spark cannot place, and holds an unknown lead mode to asking', () => {
    expect(proposalAboveLead('auto', [{ handle: 'api', posture: 'unknown' }])).toBe(
      proposedAboveOwnMode('api'),
    );
    expect(proposalAboveLead('unknown', [{ handle: 'api', posture: 'edits' }])).toBe(
      proposedAboveOwnMode('api'),
    );
    expect(proposalAboveLead('unknown', [{ handle: 'api', posture: 'asks' }])).toBeNull();
  });
});
