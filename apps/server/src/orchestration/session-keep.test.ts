import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import type { MemberRoute } from './routing.ts';
import {
  KEPT_FOR_SESSION,
  SWITCHED_FROM_SESSION,
  keepSession,
  switchEstimate,
  type ResumableSession,
} from './session-keep.ts';

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
  model: 'opus',
  modelLabel: 'Opus 5.5',
  effort: 'high',
};

const gate = { decision: 'act', actAt: 0.9, askAt: 0.6 } as unknown as MemberRoute['gate'];

const route = (pick: AgentPick, routedBy: MemberRoute['routedBy']): MemberRoute => ({
  pick,
  routedBy,
  autoWouldUse: routedBy === 'pinned' ? null : pick,
  gate: routedBy === 'jev' ? gate : null,
});

const session = (pick: AgentPick, contextTokens = 20_000): ResumableSession => ({
  pick,
  contextTokens,
});

describe('keeping the resumable session on Auto', () => {
  it('keeps the session model when the rules would change it', () => {
    const kept = keepSession(route(SONNET_HIGH, 'rules'), session(HAIKU_LOW));
    expect(kept.route.pick).toEqual(HAIKU_LOW);
    expect(kept.route.routedBy).toBe('rules');
    expect(kept.route.autoWouldUse).toEqual(SONNET_HIGH);
    expect(kept.choice).toMatchObject({ kept: true, reason: KEPT_FOR_SESSION });
  });

  it('switches when Jev passed the gate for a stronger model', () => {
    const kept = keepSession(route(OPUS_HIGH, 'jev'), session(SONNET_HIGH));
    expect(kept.route.pick).toEqual(OPUS_HIGH);
    expect(kept.choice).toMatchObject({ kept: false, reason: SWITCHED_FROM_SESSION });
  });

  it('keeps the session when a cheaper pick saves less than the lost cache costs', () => {
    const kept = keepSession(route(HAIKU_LOW, 'jev'), session(SONNET_HIGH, 60_000));
    expect(kept.route.pick).toEqual(SONNET_HIGH);
    expect(kept.choice?.kept).toBe(true);
    expect(kept.choice!.cacheLossUsd!).toBeGreaterThan(kept.choice!.savingUsd!);
  });

  it('switches to a cheaper pick when the history is small enough to resend', () => {
    const kept = keepSession(route(HAIKU_LOW, 'jev'), session(OPUS_HIGH, 1_000));
    expect(kept.route.pick).toEqual(HAIKU_LOW);
    expect(kept.choice?.kept).toBe(false);
  });

  it('changes nothing when the pick already matches, the chat is pinned, or nothing resumes', () => {
    expect(keepSession(route(HAIKU_LOW, 'jev'), session(HAIKU_LOW)).choice).toBeNull();
    expect(keepSession(route(SONNET_HIGH, 'pinned'), session(HAIKU_LOW)).route.pick).toEqual(
      SONNET_HIGH,
    );
    expect(keepSession(route(SONNET_HIGH, 'rules'), null)).toEqual({
      route: route(SONNET_HIGH, 'rules'),
      choice: null,
    });
  });

  it('prices the lost cache from the model cards', () => {
    expect(switchEstimate(session(SONNET_HIGH, 100_000), HAIKU_LOW)).toEqual({
      cacheLossUsd: (100_000 * (1 - 0.2)) / 1_000_000,
      savingUsd: (2_000 * (10 - 5)) / 1_000_000,
    });
  });
});
