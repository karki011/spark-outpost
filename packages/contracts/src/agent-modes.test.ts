import { describe, expect, it } from 'vitest';
import {
  combinationLine,
  combinationWarning,
  defaultModeFor,
  modeForLegacy,
  modeSkipsGate,
  modePosture,
  permissionFor,
  translateMode,
} from './agent-modes.ts';

describe('mode postures', () => {
  it("knows Claude's and Codex's modes", () => {
    expect(modePosture('claude', 'default')).toBe('asks');
    expect(modePosture('claude', 'acceptEdits')).toBe('edits');
    expect(modePosture('claude', 'plan')).toBe('read_only');
    expect(modePosture('claude', 'bypassPermissions')).toBe('full_access');
    expect(modePosture('codex', 'read-only')).toBe('read_only');
    expect(modePosture('codex', 'ask-every-action')).toBe('asks');
    expect(modePosture('codex', 'agent')).toBe('auto');
    expect(modePosture('codex', 'agent-full-access')).toBe('full_access');
  });

  it("reads an unknown mode from the agent's kind, then its name", () => {
    expect(modePosture('claude', 'yolo', 'full_access')).toBe('full_access');
    expect(modePosture('fake', 'reviewer', 'auto_review')).toBe('auto');
    expect(modePosture('fake', 'read-only')).toBe('read_only');
    expect(modePosture('fake', 'custom')).toBe('unknown');
  });

  it('turns read-only modes into Ask runs and everything else into Do runs', () => {
    expect(permissionFor('claude', 'plan')).toBe('ask');
    expect(permissionFor('codex', 'read-only')).toBe('ask');
    expect(permissionFor('claude', 'acceptEdits')).toBe('do');
    expect(
      permissionFor('fake', 'custom', [
        { id: 'custom', label: 'C', description: null, kind: 'plan' },
      ]),
    ).toBe('ask');
  });

  it("starts new chats in each provider's own default mode", () => {
    expect(defaultModeFor('claude')).toBe('auto');
    expect(defaultModeFor('zai')).toBe('default');
    expect(defaultModeFor('codex')).toBe('agent');
    expect(defaultModeFor('fake')).toBeNull();
  });
});

describe('modes that skip the approval gate', () => {
  it('counts only Bypass and unknown Claude modes', () => {
    for (const mode of ['default', 'acceptEdits', 'auto', 'plan']) {
      expect(modeSkipsGate('claude', mode)).toBe(false);
    }
    expect(modeSkipsGate('claude', 'bypassPermissions')).toBe(true);
    expect(modeSkipsGate('claude', 'future')).toBe(true);
  });

  it('counts Codex modes that never ask, and unknown modes', () => {
    expect(modeSkipsGate('codex', 'ask-every-action')).toBe(false);
    expect(modeSkipsGate('codex', 'agent')).toBe(true);
    expect(modeSkipsGate('codex', 'agent-full-access')).toBe(true);
    expect(modeSkipsGate('codex', 'future')).toBe(true);
    expect(modeSkipsGate('fake', 'custom')).toBe(true);
    expect(modeSkipsGate('fake', 'read-only')).toBe(false);
  });
});

describe('migrating the old levels', () => {
  it.each([
    ['claude', 'ask', null, 'plan'],
    ['claude', 'do', null, 'default'],
    ['claude', 'do', 'hands-off', 'acceptEdits'],
    ['claude', 'do', 'full-auto', 'acceptEdits'],
    ['codex', 'ask', 'full-auto', 'read-only'],
    ['codex', 'do', null, 'ask-every-action'],
    ['codex', 'do', 'hands-off', 'workspace-write'],
    ['codex', 'do', 'full-auto', 'workspace-write'],
    ['zai', 'do', 'hands-off', 'acceptEdits'],
  ] as const)('%s %s %s → %s', (provider, permission, level, mode) => {
    expect(modeForLegacy(provider, permission, level)).toBe(mode);
  });
});

describe('crew members on another agent', () => {
  it('pick the closest mode of that agent', () => {
    expect(translateMode('claude', 'acceptEdits', 'codex')).toBe('workspace-write');
    expect(translateMode('claude', 'auto', 'codex')).toBe('agent');
    expect(translateMode('claude', 'default', 'codex')).toBe('ask-every-action');
    expect(translateMode('codex', 'agent-full-access', 'claude')).toBe('bypassPermissions');
    expect(translateMode('claude', 'default', 'claude')).toBe('default');
    expect(translateMode('claude', 'acceptEdits', 'fake')).toBeNull();
  });
});

describe('the one-line summary', () => {
  const facts = { provider: 'claude', hasRepos: true } as const;

  it('says what the mode and autonomy do together', () => {
    expect(combinationLine({ ...facts, mode: 'bypassPermissions', level: 'hands-off' })).toBe(
      "Agent won't ask · kept automatically · Revert available",
    );
    expect(combinationLine({ ...facts, mode: 'default', level: 'hands-off' })).toBe(
      'Agent asks before edits and commands · kept automatically · Revert available',
    );
    expect(combinationLine({ ...facts, mode: 'plan', level: 'hands-off' })).toBe(
      'Agent only reads · nothing changes',
    );
    expect(
      combinationLine({ provider: 'codex', mode: 'agent', level: 'full-auto', hasRepos: true }),
    ).toBe(
      'Agent decides what to ask · kept and opened as a PR · in a worktree copy · Revert available',
    );
  });

  it('warns only for modes that skip the gate', () => {
    expect(combinationWarning({ ...facts, mode: 'bypassPermissions', level: 'hands-off' })).toMatch(
      /ran without review/,
    );
    expect(combinationWarning({ ...facts, mode: 'acceptEdits', level: 'hands-off' })).toBeNull();
    expect(
      combinationWarning({
        provider: 'codex',
        mode: 'agent-full-access',
        level: 'hands-off',
        hasRepos: true,
      }),
    ).toMatch(/flags anything that crosses a safety rail/);
    expect(
      combinationWarning({
        ...facts,
        mode: 'bypassPermissions',
        level: 'hands-off',
        hasRepos: false,
      }),
    ).toMatch(/ran without review/);
  });

  it('keeps a chat without a project to its own files and never mentions a pull request', () => {
    const plain = { ...facts, level: 'full-auto', hasRepos: false } as const;
    expect(combinationLine({ ...plain, mode: 'auto' })).toBe(
      'Agent decides what to ask · files stay with this chat',
    );
    expect(combinationLine({ ...plain, mode: 'plan' })).toBe('Agent only reads · nothing changes');
  });
});
