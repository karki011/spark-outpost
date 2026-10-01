import { describe, expect, it } from 'vitest';
import { modeLabel, modeSummary, permissionSummary, withCurrentMode } from './mode-summary.ts';

const modes = [
  { id: 'default', label: 'Manual', description: 'Always ask', kind: 'standard' },
  { id: 'acceptEdits', label: 'Accept edits', description: null, kind: 'standard' },
  { id: 'plan', label: 'Plan', description: null, kind: 'plan' },
];

describe('mode summary', () => {
  it("names the agent's mode and the Spark autonomy", () => {
    expect(modeSummary('claude', 'acceptEdits', 'hands-off', modes)).toBe(
      'Accept edits · Automatic',
    );
    expect(modeSummary('claude', 'default', 'balanced', modes)).toBe('Manual · Review each step');
    expect(modeSummary('claude', 'default', null, modes)).toBe('Manual · Automatic');
  });

  it('leaves out the autonomy for a read-only mode', () => {
    expect(modeSummary('claude', 'plan', 'full-auto', modes)).toBe('Plan');
    expect(modeSummary('codex', 'read-only', 'hands-off', [])).toBe('read-only');
  });

  it('names only the agent mode on the composer button, never the Spark autonomy', () => {
    const settings = {
      provider: 'claude' as const,
      model: null,
      effort: null,
      permission: null,
      agentMode: 'acceptEdits',
      level: 'full-auto' as const,
      options: {},
    };
    expect(permissionSummary(settings, undefined)).toBe('acceptEdits');
    expect(
      permissionSummary(settings, {
        provider: 'claude',
        models: [],
        efforts: [],
        defaultModel: null,
        modes,
        defaultMode: 'default',
        options: [],
        capturedAt: '2026-09-30T00:00:00.000Z',
      }),
    ).toBe('Accept edits');
  });

  it('keeps a mode the agent no longer lists', () => {
    expect(modeLabel(modes, 'yolo')).toBe('yolo');
    expect(withCurrentMode(modes, 'yolo').map((mode) => mode.id)).toEqual([
      'default',
      'acceptEdits',
      'plan',
      'yolo',
    ]);
    expect(withCurrentMode(modes, 'plan')).toHaveLength(3);
  });
});
