import { describe, expect, it } from 'vitest';
import {
  FRESH_IS_CHEAPER,
  conversationKey,
  decideConversationResume,
  freshIsCheaper,
  usesConversationSession,
} from './conversation-session.ts';
import { RESUME_REASONS, STOPPED_REPLY } from './session-decision.ts';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const stored = {
  sessionId: 's1',
  cwd: '/repo',
  additionalDirs: ['/other'],
  lastReplyHash: 'abc',
  lastUsedAt: ago(1),
  closeReason: null,
  contextUsed: 40_000,
  model: 'sonnet',
};
const input = { stored, provider: 'claude', model: 'sonnet', now: NOW, continuing: false };

describe('usesConversationSession', () => {
  it('covers chat turns and the solo Builder, and nothing else', () => {
    expect(usesConversationSession({ parentRunId: null, role: null })).toBe(true);
    expect(
      usesConversationSession({ parentRunId: 'p', role: 'builder', resumeKey: 'task:builder' }),
    ).toBe(true);
    expect(
      usesConversationSession({ parentRunId: 'p', role: 'builder', resumeKey: 'task:escalated' }),
    ).toBe(false);
    expect(
      usesConversationSession({
        parentRunId: 'p',
        role: 'builder',
        resumeKey: 'task:piece:P1',
        piece: {},
      }),
    ).toBe(false);
    expect(
      usesConversationSession({ parentRunId: 'p', role: 'critic', resumeKey: 'task:critic' }),
    ).toBe(false);
    expect(usesConversationSession({ parentRunId: 'p', role: 'scout' })).toBe(false);
  });

  it('keys the session by provider only', () => {
    expect(conversationKey('claude')).toBe('chat:claude');
    expect(conversationKey('codex')).toBe('chat:codex');
  });
});

describe('decideConversationResume', () => {
  it('opens the first session with no reason', () => {
    expect(decideConversationResume({ ...input, stored: null })).toEqual({
      resume: null,
      freshReason: null,
    });
  });

  it('resumes however long the session sat idle', () => {
    const idle = { ...stored, lastUsedAt: ago(60 * 24 * 3) };
    expect(decideConversationResume({ ...input, stored: idle })).toMatchObject({
      resume: { sessionId: 's1', cwd: '/repo', additionalDirectories: ['/other'] },
    });
  });

  it('tries to resume a session the sweeper closed as idle or evicted', () => {
    for (const closeReason of [RESUME_REASONS.idle, 'too many open sessions']) {
      const closed = { ...stored, closeReason };
      expect(decideConversationResume({ ...input, stored: closed }).resume).not.toBeNull();
    }
  });

  it('replaces a session that was closed on purpose, with that reason', () => {
    for (const closeReason of ['started fresh', 'compacted', 'task session closed']) {
      const closed = { ...stored, closeReason };
      expect(decideConversationResume({ ...input, stored: closed })).toEqual({
        resume: null,
        freshReason: closeReason,
      });
    }
  });

  it('replaces a session whose last turn never finished, unless the user asked to continue it', () => {
    const unfinished = { ...stored, lastReplyHash: null, closeReason: RESUME_REASONS.unfinished };
    expect(decideConversationResume({ ...input, stored: unfinished })).toEqual({
      resume: null,
      freshReason: RESUME_REASONS.unfinished,
    });
    expect(
      decideConversationResume({ ...input, stored: unfinished, continuing: true }),
    ).toMatchObject({ interrupted: true, resume: { sessionId: 's1' } });
  });

  it('resumes a stopped session as stopped', () => {
    const stopped = { ...stored, lastReplyHash: STOPPED_REPLY };
    expect(decideConversationResume({ ...input, stored: stopped })).toMatchObject({
      stopped: true,
    });
  });

  it('replaces a large cold session because a handoff costs less than re-reading it', () => {
    const large = { ...stored, contextUsed: 300_000, lastUsedAt: ago(30) };
    expect(decideConversationResume({ ...input, stored: large })).toEqual({
      resume: null,
      freshReason: FRESH_IS_CHEAPER,
    });
  });
});

describe('freshIsCheaper', () => {
  const large = { contextUsed: 300_000, lastUsedAt: ago(30), model: 'sonnet' };

  it('never replaces a session that is still in the cache window', () => {
    expect(freshIsCheaper({ ...large, lastUsedAt: ago(2) }, 'claude', 'sonnet', NOW)).toBe(false);
  });

  it('never replaces a session under the handoff size, however cold', () => {
    expect(freshIsCheaper({ ...large, contextUsed: 60_000 }, 'claude', 'sonnet', NOW)).toBe(false);
  });

  it('resumes when the size or the price is unknown', () => {
    expect(freshIsCheaper({ ...large, contextUsed: null }, 'claude', 'sonnet', NOW)).toBe(false);
    expect(freshIsCheaper({ ...large, model: 'mystery' }, 'claude', 'mystery', NOW)).toBe(false);
  });
});
