import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import type { MemberRoute } from './routing.ts';
import { KEPT_FOR_SESSION, keepSession, type ResumableSession } from './session-keep.ts';

const HAIKU_LOW: AgentPick = {
  provider: 'claude',
  model: 'haiku',
  modelLabel: 'Haiku 4.5',
  effort: 'low',
};
const SONNET_HIGH: AgentPick = {
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'high',
};
const OPUS_HIGH: AgentPick = {
  provider: 'claude',
  model: 'opus[1m]',
  modelLabel: 'Opus 5.5',
  effort: 'high',
};

const route = (pick: AgentPick, routedBy: MemberRoute['routedBy'] = 'rules'): MemberRoute => ({
  pick,
  routedBy,
  rule: 'chat model',
  autoWouldUse: null,
});

const session = (pick: AgentPick): ResumableSession => ({ pick, contextTokens: 20_000 });

describe('keeping the task session on Auto', () => {
  it('keeps the session model when the rules would change it mid-task', () => {
    const kept = keepSession(route(HAIKU_LOW), session(SONNET_HIGH));
    expect(kept.route.pick).toEqual(SONNET_HIGH);
    expect(kept.route.rule).toBe(KEPT_FOR_SESSION);
    expect(kept.choice).toMatchObject({ kept: true, reason: KEPT_FOR_SESSION });
  });

  it('moves to the top tier for destructive work even if the session is lost', () => {
    const kept = keepSession(route(OPUS_HIGH), session(SONNET_HIGH), true);
    expect(kept.route.pick).toEqual(OPUS_HIGH);
    expect(kept.choice).toMatchObject({ kept: false });
  });

  it('changes nothing when the pick already matches, the chat is pinned, or nothing resumes', () => {
    expect(keepSession(route(HAIKU_LOW), session(HAIKU_LOW)).choice).toBeNull();
    expect(keepSession(route(SONNET_HIGH, 'pinned'), session(HAIKU_LOW)).route.pick).toEqual(
      SONNET_HIGH,
    );
    expect(keepSession(route(SONNET_HIGH), null)).toEqual({
      route: route(SONNET_HIGH),
      choice: null,
    });
  });
});
