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

describe('a turn a workflow started', () => {
  it('gets no publishing from the chat’s Full auto → PR level', () => {
    expect(startBasis(turn)).not.toBeNull();
    const started = { ...turn, workflowStarted: true };

    expect(publishGrant(started)).toMatchObject({ level: 'hands-off', requested: false });
    expect(startBasis(started)).toBeNull();
  });
});
