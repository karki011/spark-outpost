import { describe, expect, it } from 'vitest';
import { modeLabel, modeSummary, permissionState, withCurrentMode } from './mode-summary.ts';

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
    expect(modeSummary('claude', 'default', 'full-auto', modes)).toBe('Manual · Full auto → PR');
    expect(modeSummary('claude', 'default', null, modes)).toBe('Manual · Automatic');
  });

  it('leaves out the autonomy for a read-only mode', () => {
    expect(modeSummary('claude', 'plan', 'full-auto', modes)).toBe('Plan');
    expect(modeSummary('codex', 'read-only', 'hands-off', [])).toBe('read-only');
  });

  describe('permission state', () => {
    const claudeModes = [
      ...modes,
      { id: 'auto', label: 'Auto', description: null, kind: null },
      { id: 'bypassPermissions', label: 'Bypass permissions', description: null, kind: null },
    ];
    const codexModes = [
      { id: 'read-only', label: 'Read-only', description: null, kind: 'read_only' },
      { id: 'ask-every-action', label: 'Ask every time', description: null, kind: null },
      { id: 'agent', label: 'Approve for me', description: null, kind: 'auto_review' },
      { id: 'agent-full-access', label: 'Full access', description: null, kind: 'full_access' },
    ];
    const capabilities = (
      provider: 'claude' | 'codex',
      list: typeof claudeModes,
      defaultMode: string,
    ) => ({
      provider,
      models: [],
      efforts: [],
      defaultModel: null,
      modes: list,
      defaultMode,
      options: [],
      capturedAt: '2026-10-01T00:00:00.000Z',
    });
    const settings = (provider: 'claude' | 'codex', agentMode: string | null) => ({
      provider,
      model: null,
      effort: null,
      permission: null,
      agentMode,
      level: 'full-auto' as const,
      options: {},
    });
    const claude = capabilities('claude', claudeModes, 'auto');
    const codex = capabilities('codex', codexModes, 'agent');

    it('names only the chosen mode, with or without a project folder', () => {
      expect(permissionState(settings('claude', 'auto'), claude)).toEqual({
        mode: 'auto',
        label: 'Auto',
        short: 'Auto',
        risk: 'auto',
        description: null,
      });
    });

    it('names the mode, never the Spark autonomy', () => {
      const state = permissionState(settings('claude', 'acceptEdits'), claude);
      expect(state).toMatchObject({ label: 'Accept edits', risk: 'edit' });
      expect(state.label).not.toContain('Full auto');
    });

    it('falls back to the default mode before a mode is saved', () => {
      expect(permissionState(settings('claude', null), claude).label).toBe('Auto');
      expect(permissionState(settings('claude', null), undefined).mode).toBe('auto');
      expect(permissionState(settings('codex', null), codex).label).toBe('Approve for me');
    });

    it('marks Ask (read-only) modes as reading only', () => {
      expect(permissionState(settings('claude', 'plan'), claude)).toMatchObject({
        label: 'Plan',
        risk: 'read',
      });
      expect(permissionState(settings('codex', 'read-only'), codex)).toMatchObject({
        label: 'Read-only',
        risk: 'read',
      });
    });

    it('shortens Bypass permissions and flags full-access modes', () => {
      expect(permissionState(settings('claude', 'bypassPermissions'), claude)).toMatchObject({
        label: 'Bypass permissions',
        short: 'Bypass',
        risk: 'full',
      });
      expect(permissionState(settings('codex', 'agent-full-access'), codex)).toMatchObject({
        label: 'Full access',
        short: 'Full access',
        risk: 'full',
      });
    });

    it('gives each Codex mode its risk', () => {
      expect(permissionState(settings('codex', 'ask-every-action'), codex).risk).toBe('ask');
      expect(permissionState(settings('codex', 'agent'), codex).risk).toBe('auto');
      expect(permissionState(settings('claude', 'default'), claude).risk).toBe('ask');
    });
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
