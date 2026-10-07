import { describe, expect, it } from 'vitest';
import {
  conversationKey,
  decideConversationResume,
  usesConversationSession,
} from './conversation-session.ts';
import { RESUME_REASONS, STOPPED_REPLY } from './session-decision.ts';

const stored = {
  sessionId: 's1',
  cwd: '/repo',
  additionalDirs: ['/other'],
  lastReplyHash: 'abc',
  closeReason: null,
};
const input = { stored, continuing: false };

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

  it('resumes with the folders the session was opened in', () => {
    expect(decideConversationResume(input)).toEqual({
      resume: { sessionId: 's1', cwd: '/repo', additionalDirectories: ['/other'] },
      freshReason: null,
    });
  });

  it('tries to resume whatever Spark closed the session for', () => {
    const reasons = [
      RESUME_REASONS.idle,
      RESUME_REASONS.unfinished,
      RESUME_REASONS.settings,
      'too many open sessions',
      'task session closed',
    ];
    for (const closeReason of reasons) {
      const closed = { ...stored, closeReason };
      expect(decideConversationResume({ ...input, stored: closed }).resume).not.toBeNull();
    }
  });

  it('starts fresh only when the user closed the session', () => {
    for (const closeReason of ['started fresh', 'compacted', 'moved to a fresh chat']) {
      const closed = { ...stored, closeReason };
      expect(decideConversationResume({ ...input, stored: closed })).toEqual({
        resume: null,
        freshReason: closeReason,
      });
    }
  });

  it('resumes a session whose last turn never finished, marked interrupted when the user continues it', () => {
    const unfinished = { ...stored, lastReplyHash: null, closeReason: RESUME_REASONS.unfinished };
    expect(decideConversationResume({ ...input, stored: unfinished })).toEqual({
      resume: { sessionId: 's1', cwd: '/repo', additionalDirectories: ['/other'] },
      freshReason: null,
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
});
