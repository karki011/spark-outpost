import { describe, expect, it } from 'vitest';
import { publishGrant, startBasis } from './publish-context.ts';

const turn = {
  identity: { threadId: 'chat' },
  workspaceId: 'workspace',
  userRequest: '@pr-review',
  level: 'full-auto' as const,
  provider: 'claude',
  agentMode: 'default',
  followUpRound: false,
  assistantSent: true,
};

const MODES = [
  ['claude', 'default'],
  ['claude', 'auto'],
  ['claude', 'bypassPermissions'],
  ['codex', 'agent'],
  ['codex', 'agent-full-access'],
] as const;

describe('a turn a workflow started', () => {
  it('gets no publishing from the chat’s Full auto → PR level', () => {
    expect(startBasis(turn)).not.toBeNull();
    const started = { ...turn, workflowStarted: true };

    expect(publishGrant(started)).toMatchObject({ withheld: true, requested: false });
    expect(startBasis(started)).toBeNull();
  });

  it.each(MODES)('gets no publishing from the agent mode %s %s', (provider, agentMode) => {
    const started = { ...turn, level: 'hands-off' as const, provider, agentMode };
    expect(startBasis({ ...started, workflowStarted: true })).toBeNull();
  });

  it('still lets a mode that performs publish when the turn is not a workflow’s', () => {
    expect(startBasis({ ...turn, level: 'hands-off', agentMode: 'auto' })).toBe('mode');
  });
});
