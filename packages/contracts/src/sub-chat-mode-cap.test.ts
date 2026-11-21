import { describe, expect, it } from 'vitest';
import type { ProviderCapabilities } from './chat-settings.ts';
import { aboveParentMode, cappedMode } from './sub-chat-mode-cap.ts';

const CODEX_CAPABILITIES: ProviderCapabilities = {
  provider: 'codex',
  models: [],
  efforts: [],
  defaultModel: null,
  modes: [
    { id: 'read-only', label: 'Read-only', description: null, kind: 'standard' },
    { id: 'agent', label: 'Auto review', description: null, kind: 'auto_review' },
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

describe('the mode cap between a parent chat and a sub-chat it proposes', () => {
  it('lets a proposed chat ask as often as the parent or more often, never less', () => {
    expect(aboveParentMode('asks', 'read_only')).toBe(false);
    expect(aboveParentMode('asks', 'asks')).toBe(false);
    expect(aboveParentMode('asks', 'edits')).toBe(true);
    expect(aboveParentMode('edits', 'auto')).toBe(true);
    expect(aboveParentMode('full_access', 'full_access')).toBe(false);
  });

  it('treats a mode it cannot place as the most open for a chat and as asking for a parent', () => {
    expect(aboveParentMode('auto', 'unknown')).toBe(true);
    expect(aboveParentMode('unknown', 'edits')).toBe(true);
    expect(aboveParentMode('unknown', 'asks')).toBe(false);
  });

  it('allows the parent’s own mode, except one it cannot place', () => {
    for (const posture of [
      'read_only',
      'asks',
      'denies',
      'edits',
      'auto',
      'full_access',
    ] as const) {
      expect(aboveParentMode(posture, posture)).toBe(false);
    }
    expect(aboveParentMode('unknown', 'unknown')).toBe(true);
  });

  it('treats asking and denying as the same rank', () => {
    expect(aboveParentMode('asks', 'denies')).toBe(false);
    expect(aboveParentMode('denies', 'asks')).toBe(false);
  });

  it('lets an unknown chat mode through only under a parent with full access', () => {
    expect(aboveParentMode('full_access', 'unknown')).toBe(false);
    expect(aboveParentMode('auto', 'full_access')).toBe(true);
    expect(aboveParentMode('read_only', 'asks')).toBe(true);
  });
});

describe('cappedMode', () => {
  it('keeps a mode that asks at least as often as the parent', () => {
    expect(cappedMode('claude', 'default', CLAUDE_CAPABILITIES, 'edits')).toBe('default');
    expect(cappedMode('claude', 'acceptEdits', CLAUDE_CAPABILITIES, 'edits')).toBe('acceptEdits');
  });

  it('keeps no mode when the agent default is within the parent’s', () => {
    expect(cappedMode('claude', null, CLAUDE_CAPABILITIES, 'auto')).toBeNull();
  });

  it('lowers a mode above the parent’s to the highest one the parent allows', () => {
    expect(cappedMode('claude', 'bypassPermissions', CLAUDE_CAPABILITIES, 'edits')).toBe(
      'acceptEdits',
    );
    expect(cappedMode('claude', null, CLAUDE_CAPABILITIES, 'read_only')).toBe('plan');
    expect(cappedMode('codex', 'agent', CODEX_CAPABILITIES, 'asks')).toBe('read-only');
  });

  it('treats a parent in an unknown mode as one that asks', () => {
    expect(cappedMode('claude', 'auto', CLAUDE_CAPABILITIES, 'unknown')).toBe('default');
  });

  it('never raises: with no lower mode known it keeps what was wanted', () => {
    expect(cappedMode('claude', null, undefined, 'read_only')).toBeNull();
    expect(cappedMode('claude', 'auto', undefined, 'read_only')).toBe('auto');
  });
});
