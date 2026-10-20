import { describe, expect, it } from 'vitest';
import type { ProviderCapabilities } from './chat-settings.ts';
import { aboveLeadMode, cappedMode, chatModeRank, leadModeLimit } from './outpost-mode-cap.ts';

const CODEX_CAPABILITIES: ProviderCapabilities = {
  provider: 'codex',
  models: [],
  efforts: [],
  defaultModel: null,
  modes: [
    { id: 'read-only', label: 'Read-only', description: null, kind: 'standard' },
    { id: 'agent', label: 'Approve for me', description: null, kind: 'auto_review' },
  ],
  defaultMode: 'agent',
  options: [],
  capturedAt: '2026-10-09T10:00:00.000Z',
};

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  ...CODEX_CAPABILITIES,
  provider: 'claude',
  modes: [
    { id: 'plan', label: 'Plan', description: null, kind: null },
    { id: 'default', label: 'Manual', description: null, kind: null },
    { id: 'acceptEdits', label: 'Accept edits', description: null, kind: null },
    { id: 'auto', label: 'Auto', description: null, kind: null },
    { id: 'bypassPermissions', label: 'Bypass permissions', description: null, kind: null },
  ],
  defaultMode: 'auto',
};

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

describe('cappedMode', () => {
  it('keeps a mode that asks at least as often as the lead', () => {
    expect(cappedMode('claude', 'default', CLAUDE_CAPABILITIES, 'edits')).toBe('default');
    expect(cappedMode('claude', 'acceptEdits', CLAUDE_CAPABILITIES, 'edits')).toBe('acceptEdits');
  });

  it('keeps no mode when the agent default is within the lead', () => {
    expect(cappedMode('claude', null, CLAUDE_CAPABILITIES, 'auto')).toBeNull();
  });

  it('lowers a mode above the lead to the highest one the lead allows', () => {
    expect(cappedMode('claude', 'bypassPermissions', CLAUDE_CAPABILITIES, 'edits')).toBe(
      'acceptEdits',
    );
    expect(cappedMode('claude', null, CLAUDE_CAPABILITIES, 'read_only')).toBe('plan');
    expect(cappedMode('codex', 'agent', CODEX_CAPABILITIES, 'asks')).toBe('read-only');
  });

  it('treats a lead in an unknown mode as one that asks', () => {
    expect(cappedMode('claude', 'auto', CLAUDE_CAPABILITIES, 'unknown')).toBe('default');
  });

  it('never raises: with no lower mode known it keeps what was wanted', () => {
    expect(cappedMode('claude', null, undefined, 'read_only')).toBeNull();
    expect(cappedMode('claude', 'auto', undefined, 'read_only')).toBe('auto');
  });
});
