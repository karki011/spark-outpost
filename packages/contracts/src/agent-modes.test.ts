import { describe, expect, it } from 'vitest';
import {
  combinationLine,
  combinationWarning,
  defaultModeFor,
  modeForLegacy,
  modeNeedsWorktree,
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

describe('where a mode may run', () => {
  it('keeps Claude modes that ask or decide on the checkout, and Bypass in a worktree copy', () => {
    for (const mode of ['default', 'acceptEdits', 'auto', 'plan']) {
      expect(modeNeedsWorktree('claude', mode)).toBe(false);
    }
    expect(modeNeedsWorktree('claude', 'bypassPermissions')).toBe(true);
    expect(modeNeedsWorktree('claude', 'future')).toBe(true);
  });

  it('puts Codex modes that skip the gate, and unknown modes, in a worktree copy', () => {
    expect(modeNeedsWorktree('codex', 'ask-every-action')).toBe(false);
    expect(modeNeedsWorktree('codex', 'agent')).toBe(true);
    expect(modeNeedsWorktree('codex', 'agent-full-access')).toBe(true);
    expect(modeNeedsWorktree('codex', 'future')).toBe(true);
    expect(modeNeedsWorktree('fake', 'custom')).toBe(true);
    expect(modeNeedsWorktree('fake', 'read-only')).toBe(false);
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
    ['codex', 'do', 'hands-off', 'agent'],
    ['codex', 'do', 'full-auto', 'agent'],
    ['zai', 'do', 'hands-off', 'acceptEdits'],
  ] as const)('%s %s %s → %s', (provider, permission, level, mode) => {
    expect(modeForLegacy(provider, permission, level)).toBe(mode);
  });
});

describe('crew members on another agent', () => {
  it('pick the closest mode of that agent', () => {
    expect(translateMode('claude', 'acceptEdits', 'codex')).toBe('agent');
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
      "Agent won't ask · kept automatically · in a worktree copy · Revert available",
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

  it('warns only for worktree-only modes', () => {
    expect(combinationWarning({ ...facts, mode: 'bypassPermissions', level: 'hands-off' })).toMatch(
      /runs only in a worktree copy/,
    );
    expect(combinationWarning({ ...facts, mode: 'acceptEdits', level: 'hands-off' })).toBeNull();
    expect(
      combinationWarning({
        provider: 'codex',
        mode: 'agent-full-access',
        level: 'hands-off',
        hasRepos: true,
      }),
    ).toMatch(/worktree copy/);
    expect(
      combinationWarning({
        ...facts,
        mode: 'bypassPermissions',
        level: 'hands-off',
        hasRepos: false,
      }),
    ).toBeNull();
  });
});
