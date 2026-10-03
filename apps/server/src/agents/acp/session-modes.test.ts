import { describe, expect, it } from 'vitest';
import type { ProviderTurn } from '../../providers/provider.ts';
import { agentDefinitions } from './agents.ts';
import { modeAllowed, modeWish } from './session-modes.ts';

const turn = (mode: string | null, worktree = false): ProviderTurn => ({
  prompt: 'x',
  history: [],
  settings: { method: 'cli', model: null, modelLabel: null, effort: null, mode },
  signal: new AbortController().signal,
  ...(worktree ? { worktree: true } : {}),
});

describe('the mode a session starts in', () => {
  const { claude, codex } = agentDefinitions;

  it('uses the chat mode for plain chats and the read-only mode for Ask', () => {
    expect(modeWish(claude, turn('bypassPermissions'), false, false)).toEqual({
      wanted: 'default',
    });
    expect(modeWish(codex, turn('agent'), true, false)).toEqual({ wanted: 'read-only' });
  });

  it("uses the chat's mode in Do, falling back to the asking mode", () => {
    expect(modeWish(claude, turn('acceptEdits'), true, true)).toEqual({
      wanted: 'acceptEdits',
      fallback: 'default',
    });
    expect(modeWish(claude, turn(null), true, true)).toEqual({
      wanted: 'default',
      fallback: 'default',
    });
  });

  it('keeps worktree-only modes off the checkout and a read-only pick out of Do', () => {
    expect(modeWish(codex, turn('agent'), true, true)).toEqual({
      wanted: 'ask-every-action',
      note: 'agent runs only in a worktree copy; asking instead',
    });
    expect(modeWish(codex, turn('agent', true), true, true)).toEqual({
      wanted: 'agent',
      fallback: 'ask-every-action',
    });
    expect(modeWish(claude, turn('plan'), true, true)).toEqual({ wanted: 'default' });
  });
});

describe('the modes a running session may switch to', () => {
  const { claude, codex } = agentDefinitions;

  it('lets Ask switch only between read-only modes', () => {
    const allowed = modeAllowed(codex, turn(null), true, false);
    expect(allowed('read-only')).toBe(true);
    expect(allowed('agent')).toBe(false);
  });

  it('lets Claude Do switch to any mode, Bypass only in a worktree copy', () => {
    const allowed = modeAllowed(claude, turn(null), true, true);
    for (const mode of ['plan', 'acceptEdits', 'auto']) {
      expect(allowed(mode)).toBe(true);
    }
    expect(allowed('bypassPermissions')).toBe(false);
    expect(modeAllowed(claude, turn(null, true), true, true)('bypassPermissions')).toBe(true);
  });

  it('lets Codex Do use worktree-only modes only in a worktree copy', () => {
    expect(modeAllowed(codex, turn(null), true, true)('agent-full-access')).toBe(false);
    expect(modeAllowed(codex, turn(null, true), true, true)('agent-full-access')).toBe(true);
  });
});

describe('planning in Ask (B5)', () => {
  const { claude, codex } = agentDefinitions;
  const planning = (mode: string | null): ProviderTurn => ({ ...turn(mode), planning: true });

  it('asks for the native plan mode on a planning Ask turn in a project', () => {
    expect(modeWish(claude, planning('default'), true, false)).toEqual({
      wanted: 'default',
      plan: true,
    });
    expect(modeWish(codex, planning(null), true, false)).toEqual({
      wanted: 'read-only',
      plan: true,
    });
  });

  it('never plans in a plain chat or in Do', () => {
    expect(modeWish(claude, planning('default'), false, false)).toEqual({ wanted: 'default' });
    expect(modeWish(claude, planning('default'), true, true)).toEqual({
      wanted: 'default',
      fallback: 'default',
    });
  });
});
