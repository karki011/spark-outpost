import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { CAPABILITY_REASONS, sparkCapability, type SparkJobFacts } from './spark-capability.ts';

const working: SparkJobFacts = {
  kind: 'mention',
  reviewRun: false,
  beforePublish: false,
  testRun: false,
  hasProject: true,
  chatWorktree: true,
  isSubChat: false,
  origin: 'typed_mac',
  posture: 'edits',
  level: null,
  confirmed: true,
};

const fullAuto: SparkJobFacts = { ...working, level: 'full-auto' };

function decide(change: Partial<SparkJobFacts>, from: SparkJobFacts = working) {
  return sparkCapability({ ...from, ...change });
}

const EDITING: readonly ModePosture[] = ['asks', 'edits', 'auto', 'full_access'];
const READING: readonly ModePosture[] = ['read_only', 'denies', 'unknown'];
const KINDS = ['mention', 'step', 'tool'] as const;
const ORIGINS = ['typed_mac', 'tool', 'step', 'other'] as const;
const LEVELS = ['full-auto', 'hands-off', null] as const;

describe('what a Spark handed a job may do', () => {
  it.each(EDITING)('works in the chat’s worktree in a mode that %s', (posture) => {
    expect(decide({ posture })).toEqual({ capability: 'work', reason: CAPABILITY_REASONS.work });
  });

  it.each(KINDS)('works as a %s when nothing stops it', (kind) => {
    expect(decide({ kind }).capability).toBe('work');
  });

  it.each(['hands-off', null] as const)('works at level %s', (level) => {
    expect(decide({ level }).capability).toBe('work');
  });

  it('reads in a review, whatever else is true', () => {
    expect(decide({ reviewRun: true }, fullAuto)).toEqual({
      capability: 'read',
      reason: CAPABILITY_REASONS.review,
    });
  });

  it('reads in a Before publish review', () => {
    expect(decide({ beforePublish: true }, fullAuto)).toEqual({
      capability: 'read',
      reason: CAPABILITY_REASONS.beforePublish,
    });
  });

  it('reads in a chat with no project, even at Full auto → PR', () => {
    expect(decide({ hasProject: false }, fullAuto)).toEqual({
      capability: 'read',
      reason: CAPABILITY_REASONS.noProject,
    });
  });

  it.each(READING)('reads when the Spark’s mode is %s, even at Full auto → PR', (posture) => {
    expect(decide({ posture }, fullAuto)).toEqual({
      capability: 'read',
      reason: CAPABILITY_REASONS.readOnlyMode,
    });
  });

  it('reads until the user confirmed the Spark’s mode, even at Full auto → PR', () => {
    expect(decide({ confirmed: false })).toEqual({
      capability: 'read',
      reason: CAPABILITY_REASONS.unconfirmed,
    });
    expect(decide({ confirmed: false }, fullAuto).capability).toBe('read');
  });

  it('reads for a job the user did not type on the Mac, even at Full auto → PR', () => {
    expect(decide({ origin: 'other' })).toEqual({
      capability: 'read',
      reason: CAPABILITY_REASONS.notTyped,
    });
    expect(decide({ origin: 'other' }, fullAuto).capability).toBe('read');
  });

  it.each(['typed_mac', 'tool'] as const)(
    'gives a Full auto → PR Spark its own sub-chat for a %s job',
    (origin) => {
      expect(decide({ origin }, fullAuto)).toEqual({
        capability: 'sub_chat',
        reason: CAPABILITY_REASONS.ownChat,
      });
      expect(decide({ origin, kind: 'tool', chatWorktree: false }, fullAuto).capability).toBe(
        'sub_chat',
      );
    },
  );

  it('never starts a sub-chat from a sub-chat, a test run, a step or a step’s origin', () => {
    expect(decide({ isSubChat: true }, fullAuto).capability).toBe('work');
    expect(decide({ testRun: true }, fullAuto).capability).toBe('work');
    expect(decide({ kind: 'step' }, fullAuto).capability).toBe('work');
    expect(decide({ origin: 'step' }, fullAuto).capability).toBe('work');
  });

  it('reads in a chat that works in the user’s checkout', () => {
    expect(decide({ chatWorktree: false })).toEqual({
      capability: 'read',
      reason: CAPABILITY_REASONS.checkout,
    });
    expect(decide({ chatWorktree: false, kind: 'step' }, fullAuto).capability).toBe('read');
  });

  it('never works or starts a sub-chat while unconfirmed, in every combination', () => {
    for (const kind of KINDS) {
      for (const origin of ORIGINS) {
        for (const level of LEVELS) {
          for (const posture of [...EDITING, ...READING]) {
            for (const chatWorktree of [true, false]) {
              const facts = { kind, origin, level, posture, chatWorktree, confirmed: false };
              expect(decide(facts).capability).toBe('read');
            }
          }
        }
      }
    }
  });

  it('never gives more than read to a reading mode, a review or an untyped job', () => {
    for (const kind of KINDS) {
      for (const level of LEVELS) {
        for (const testRun of [true, false]) {
          const facts = { kind, level, testRun };
          expect(decide({ ...facts, posture: 'read_only' }).capability).toBe('read');
          expect(decide({ ...facts, reviewRun: true }).capability).toBe('read');
          expect(decide({ ...facts, beforePublish: true }).capability).toBe('read');
          expect(decide({ ...facts, origin: 'other' }).capability).toBe('read');
          expect(decide({ ...facts, hasProject: false }).capability).toBe('read');
        }
      }
    }
  });
});
