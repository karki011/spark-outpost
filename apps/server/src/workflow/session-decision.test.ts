import { describe, expect, it } from 'vitest';
import {
  agentKey,
  decideResume,
  replyHash,
  sessionWorkdir,
  settingsHash,
  CREW_STOPPED_NOTE,
  STOPPED_NOTE,
  STOPPED_REPLY,
  stoppedFollowUp,
  type DecisionInput,
  type SessionSettings,
  type StoredState,
} from './session-decision.ts';

const settings: SessionSettings = {
  provider: 'claude',
  model: 'sonnet',
  effort: 'medium',
  mode: 'ask',
  planning: false,
  roots: ['/work/app'],
};

describe('settingsHash', () => {
  it('is stable for the same settings', () => {
    expect(settingsHash(settings)).toBe(settingsHash({ ...settings, roots: ['/work/app'] }));
  });

  it.each([
    ['provider', { provider: 'codex' }],
    ['model', { model: 'opus' }],
    ['effort', { effort: 'high' }],
    ['mode', { mode: 'do' as const }],
    ['tools for planning', { planning: true }],
    ['repos', { roots: ['/work/app', '/work/lib'] }],
  ])('changes with the %s', (_name, change) => {
    expect(settingsHash({ ...settings, ...change })).not.toBe(settingsHash(settings));
  });

  it('keeps a keyed session across an effort change only where the cache survives it', () => {
    const opus = { ...settings, model: 'opus[1m]', keyed: true };
    expect(settingsHash({ ...opus, effort: 'high' })).toBe(settingsHash(opus));
    expect(settingsHash({ ...opus, keyed: false, effort: 'high' })).not.toBe(
      settingsHash({ ...opus, keyed: false }),
    );
    const sonnet = { ...settings, keyed: true };
    expect(settingsHash({ ...sonnet, effort: 'high' })).not.toBe(settingsHash(sonnet));
  });

  it('changes when the primary repo changes', () => {
    const two = { ...settings, roots: ['/work/app', '/work/lib'] };
    expect(settingsHash({ ...two, roots: ['/work/lib', '/work/app'] })).not.toBe(settingsHash(two));
  });
});

describe('agentKey and sessionWorkdir', () => {
  it('keys chat turns by mode and children by their resume key', () => {
    expect(agentKey('do', null)).toBe('chat:do');
    expect(agentKey(null, null)).toBe('chat:chat');
    expect(agentKey('do', 'task-1:builder:Bolt')).toBe('key:task-1:builder:Bolt');
  });

  it('gives each conversation and key its own stable folder', () => {
    const one = sessionWorkdir('c1', 'chat:chat');
    expect(sessionWorkdir('c1', 'chat:chat')).toBe(one);
    expect(sessionWorkdir('c2', 'chat:chat')).not.toBe(one);
    expect(sessionWorkdir('c1', 'chat:ask')).not.toBe(one);
  });
});

const now = new Date('2026-09-26T12:00:00Z');
const hash = settingsHash(settings);
const stored: StoredState = {
  sessionId: 's-1',
  cwd: '/work/app',
  additionalDirs: [],
  settingsHash: hash,
  lastMessageId: 'm-2',
  lastReplyHash: replyHash('Sure.'),
  lastMessageContent: 'Sure.',
  lastUsedAt: new Date(now.getTime() - 60_000),
  closeReason: null,
};
const input: DecisionInput = {
  stored,
  hash,
  previousMessageId: 'm-2',
  checksMessages: true,
  now,
  idleMs: 30 * 60_000,
};

describe('decideResume', () => {
  it('resumes when nothing changed since the last reply', () => {
    expect(decideResume(input)).toEqual({
      resume: { sessionId: 's-1', cwd: '/work/app', additionalDirectories: [] },
      freshReason: null,
    });
  });

  it('starts fresh without a note on the first turn', () => {
    expect(decideResume({ ...input, stored: null })).toEqual({ resume: null, freshReason: null });
  });

  it.each<[string, Partial<DecisionInput>, string]>([
    ['settings changed', { hash: 'other' }, 'settings changed'],
    [
      'settings changed in the same folder',
      { hash: 'other', cwd: '/work/app' },
      'settings changed',
    ],
    ['the project folder changed', { hash: 'other', cwd: '/work/other' }, 'project changed'],
    ['idle', { now: new Date(now.getTime() + 31 * 60_000) }, 'idle'],
    ['another message came between', { previousMessageId: 'm-9' }, 'chat changed since'],
    [
      'the reply was extended by someone else',
      { stored: { ...stored, lastMessageContent: 'Sure.\n\nAI review: concerns.' } },
      'chat changed since',
    ],
    [
      'last turn unfinished',
      { stored: { ...stored, lastReplyHash: null } },
      'last turn did not finish',
    ],
    ['closed', { stored: { ...stored, closeReason: 'started fresh' } }, 'started fresh'],
  ])('starts fresh when %s', (_name, change, reason) => {
    expect(decideResume({ ...input, ...change })).toEqual({ resume: null, freshReason: reason });
  });

  it('ignores the chat messages for orchestration children', () => {
    const child = { ...input, checksMessages: false, previousMessageId: null };
    const decision = decideResume({ ...child, stored: { ...stored, lastMessageId: null } });
    expect(decision.resume?.sessionId).toBe('s-1');
  });

  it('resumes a turn the user stopped, for orchestration children', () => {
    const child = { ...input, checksMessages: false, previousMessageId: null };
    const stopped = { ...stored, lastMessageId: null, lastReplyHash: STOPPED_REPLY };
    expect(decideResume({ ...child, stored: stopped })).toEqual({
      resume: { sessionId: 's-1', cwd: '/work/app', additionalDirectories: [] },
      freshReason: null,
      stopped: true,
    });
  });

  it('resumes a stopped chat turn only while its partial reply is still the last message', () => {
    const stopped = { ...stored, lastReplyHash: STOPPED_REPLY, lastMessageContent: 'Half a rep' };
    expect(decideResume({ ...input, stored: stopped })).toMatchObject({
      resume: { sessionId: 's-1' },
      stopped: true,
    });
    expect(decideResume({ ...input, stored: stopped, previousMessageId: 'm-9' })).toEqual({
      resume: null,
      freshReason: 'chat changed since',
    });
    expect(decideResume({ ...input, stored: { ...stopped, lastMessageId: null } })).toEqual({
      resume: null,
      freshReason: 'last turn did not finish',
    });
  });

  it('still starts fresh after a crash, a closed session or new settings, even when stopped', () => {
    const child = { ...input, checksMessages: false, previousMessageId: null };
    const crashed = { ...stored, lastMessageId: null, lastReplyHash: null };
    expect(decideResume({ ...child, stored: crashed }).freshReason).toBe(
      'last turn did not finish',
    );
    const stopped = { ...stored, lastMessageId: null, lastReplyHash: STOPPED_REPLY };
    expect(decideResume({ ...child, stored: { ...stopped, closeReason: 'failed' } })).toEqual({
      resume: null,
      freshReason: 'failed',
    });
    expect(decideResume({ ...child, stored: stopped, hash: 'other' }).freshReason).toBe(
      'settings changed',
    );
  });

  it('never mistakes the stop marker for a reply hash', () => {
    expect(STOPPED_REPLY).not.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('stoppedFollowUp', () => {
  it('tells the agent it was stopped, lists the changed files, then gives the message', () => {
    expect(stoppedFollowUp('continue', ['src/export.ts', 'test/export.test.ts'])).toBe(
      `${STOPPED_NOTE}\nFiles changed before the stop: \`src/export.ts\`, \`test/export.test.ts\`.\n\ncontinue`,
    );
    expect(stoppedFollowUp('continue', [])).toBe(`${STOPPED_NOTE}\n\ncontinue`);
    expect(stoppedFollowUp('continue', [], CREW_STOPPED_NOTE)).toBe(
      `${CREW_STOPPED_NOTE}\n\ncontinue`,
    );
    expect(CREW_STOPPED_NOTE).not.toContain('by the user');
  });

  it('shortens a long file list', () => {
    const files = Array.from({ length: 23 }, (_, index) => `f${index}.ts`);
    expect(stoppedFollowUp('go on', files)).toContain('`f19.ts`, and 3 more.');
  });
});

describe('an explicit Continue after an interruption', () => {
  const unfinished: StoredState = { ...stored, lastMessageId: null, lastReplyHash: null };
  const session = { sessionId: 's-1', cwd: '/work/app', additionalDirectories: [] };

  it('reopens the session whose last turn never finished, only when the user asked', () => {
    expect(decideResume({ ...input, stored: unfinished }).freshReason).toBe(
      'last turn did not finish',
    );
    expect(decideResume({ ...input, stored: unfinished, continuing: true })).toEqual({
      resume: session,
      freshReason: null,
      interrupted: true,
    });
  });

  it('reopens it after the idle limit, also when the sweep already closed it as idle', () => {
    const later = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const waited = { ...input, stored: unfinished, now: later, continuing: true };
    expect(decideResume(waited).resume).toEqual(session);
    const swept = { ...unfinished, closeReason: 'idle' };
    expect(decideResume({ ...waited, stored: swept }).resume).toEqual(session);
  });

  it('reopens it when the worker closed it as unfinished while winding the turn down', () => {
    const wound = { ...unfinished, closeReason: 'last turn did not finish' };
    expect(decideResume({ ...input, stored: wound, continuing: true }).resume).toEqual(session);
    expect(decideResume({ ...input, stored: wound }).freshReason).toBe('last turn did not finish');
  });

  it('still starts fresh when the session was closed for another reason or the settings changed', () => {
    for (const closeReason of ['started fresh', 'chat archived', 'too many open sessions']) {
      expect(
        decideResume({ ...input, stored: { ...unfinished, closeReason }, continuing: true }),
      ).toEqual({ resume: null, freshReason: closeReason });
    }
    expect(
      decideResume({ ...input, stored: unfinished, hash: 'other', continuing: true }).freshReason,
    ).toBe('settings changed');
  });

  it('changes nothing for a session whose last turn finished', () => {
    const later = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    expect(decideResume({ ...input, continuing: true })).toEqual(decideResume(input));
    expect(decideResume({ ...input, now: later, continuing: true }).freshReason).toBe('idle');
    expect(
      decideResume({ ...input, stored: { ...stored, closeReason: 'idle' }, continuing: true })
        .freshReason,
    ).toBe('idle');
  });
});
