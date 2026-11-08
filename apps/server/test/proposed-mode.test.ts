import { describe, expect, it } from 'vitest';
import { modeChoices, proposedModeId, unknownProposedMode } from '../src/outposts/proposed-mode.ts';
import { FAKE_CLAUDE_MODES, FAKE_CODEX_MODES } from '../src/providers/fake.ts';

describe('the mode a draft names for a chat', () => {
  const claude = modeChoices('claude', FAKE_CLAUDE_MODES);
  const codex = modeChoices('codex', FAKE_CODEX_MODES);

  it('is found by id', () => {
    expect(proposedModeId(claude, 'auto')).toBe('auto');
    expect(proposedModeId(claude, 'bypassPermissions')).toBe('bypassPermissions');
    expect(proposedModeId(codex, 'agent-full-access')).toBe('agent-full-access');
  });

  it('is found by the label the session advertises, in any letter case', () => {
    expect(proposedModeId(claude, 'Auto')).toBe('auto');
    expect(proposedModeId(claude, 'bypass PERMISSIONS')).toBe('bypassPermissions');
    expect(proposedModeId(claude, 'Manual')).toBe('default');
    expect(proposedModeId(codex, 'ask every time')).toBe('ask-every-action');
  });

  it('prefers an id over another mode’s label', () => {
    expect(proposedModeId(claude, 'default')).toBe('default');
    expect(proposedModeId(claude, 'PLAN')).toBe('plan');
  });

  it('matches whole names only', () => {
    expect(proposedModeId(claude, 'aut')).toBeNull();
    expect(proposedModeId(claude, 'Auto mode')).toBeNull();
    expect(proposedModeId(codex, 'Auto')).toBeNull();
  });

  it('knows the provider’s own mode ids before any session advertised a list', () => {
    const bare = modeChoices('claude', []);
    expect(proposedModeId(bare, 'acceptEdits')).toBe('acceptEdits');
    expect(proposedModeId(bare, 'AUTO')).toBe('auto');
    expect(modeChoices('claude', FAKE_CLAUDE_MODES).map((choice) => choice.id)).toContain(
      'dontAsk',
    );
  });

  it('lists the valid modes when the value is none of them', () => {
    expect(unknownProposedMode('web', 'Turbo', codex)).toBe(
      '@web: "Turbo" is not a mode of this agent. Modes: Read-only (read-only), Ask every time (ask-every-action), Workspace access (workspace-write), Auto review (agent), Full access (agent-full-access). Use one of these, or leave the mode out.',
    );
  });
});
