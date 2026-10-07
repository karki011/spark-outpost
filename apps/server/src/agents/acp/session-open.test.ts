import { describe, expect, it } from 'vitest';
import type { ProviderTurn } from '../../providers/provider.ts';
import {
  CATCH_UP_HEADING,
  afterOpening,
  catchUp,
  handoffNote,
  FRESH_REASONS,
  sameWorkspace,
  sessionNote,
  whyResumeFailed,
} from './session-open.ts';

const turn = (session?: ProviderTurn['session']): ProviderTurn => ({
  prompt: 'What changed?',
  history: [
    { role: 'user', content: 'Fix the divider' },
    { role: 'assistant', content: 'Fixed it.' },
  ],
  settings: { method: 'cli', model: null, modelLabel: null, effort: null },
  signal: new AbortController().signal,
  preamble: 'You are in a project.',
  ...(session ? { session } : {}),
});
const target = { workdir: null, resume: null, freshReason: null };
const opened = (continued: boolean, freshReason: string | null = null) =>
  ({ continued, freshReason }) as Parameters<typeof sessionNote>[0];

describe('afterOpening', () => {
  it('sends a resumed session only the new message', () => {
    const sent = afterOpening(turn(target), true);
    expect(sent.history).toEqual([]);
    expect(sent.session?.followUp).toBeUndefined();
  });

  it('tells a resumed session what it missed, then the request', () => {
    const missed = [{ role: 'assistant' as const, content: 'Opened pull request #1' }];
    const sent = afterOpening(turn({ ...target, missed }), true);
    expect(sent.session?.followUp).toBe(
      `${CATCH_UP_HEADING}\n\nReply shown to the user: Opened pull request #1\n\nNow:\n\nWhat changed?`,
    );
  });

  it('keeps the follow-up the turn already had', () => {
    const missed = [{ role: 'user' as const, content: 'Also update the docs' }];
    const sent = afterOpening(turn({ ...target, missed, followUp: 'Continue.' }), true);
    expect(sent.session?.followUp).toContain('User: Also update the docs');
    expect(sent.session?.followUp?.endsWith('Now:\n\nContinue.')).toBe(true);
  });

  it('seeds a replaced session with the handoff instead of the raw history', () => {
    const sent = afterOpening(
      turn({ ...target, handoff: '# Handoff from the earlier session' }),
      false,
    );
    expect(sent.history).toEqual([]);
    expect(sent.preamble).toBe('# Handoff from the earlier session\n\nYou are in a project.');
  });

  it('leaves a first session as it was', () => {
    const first = turn(target);
    expect(afterOpening(first, false)).toBe(first);
  });
});

describe('catchUp', () => {
  it('shows the last six missed messages, clipped, and counts the rest', () => {
    const missed = Array.from({ length: 8 }, (_, index) => ({
      role: 'user' as const,
      content: index === 7 ? 'x'.repeat(2_000) : `message ${index}`,
    }));
    const text = catchUp(missed, 'Now what?');
    expect(text).toContain('(2 earlier messages left out)');
    expect(text).not.toContain('message 1\n');
    expect(text).toContain('User: message 2');
    expect(text).toContain(`${'x'.repeat(1_500)}…`);
  });

  it('is just the request when nothing was missed', () => {
    expect(catchUp([], 'Now what?')).toBe('Now what?');
  });
});

describe('session notes', () => {
  it('says in one line that a replaced session got a handoff, with the reason', () => {
    expect(sessionNote(opened(false, "couldn't resume"), { ...target, handoff: 'h' })).toBe(
      handoffNote("couldn't resume"),
    );
    expect(handoffNote(null)).toBe(
      "Started a fresh agent session (the agent couldn't reopen the earlier one). It has a handoff of the goal, plan, changes and last three exchanges",
    );
  });

  it('keeps the existing notes without a handoff', () => {
    expect(sessionNote(opened(true), target)).toBe('Continued session');
    expect(sessionNote(opened(false), { ...target, freshReason: 'idle' })).toBe(
      'Fresh session (idle)',
    );
  });
});

describe('sameWorkspace', () => {
  it('compares the folder and the extra folders in any order', () => {
    const stored = { sessionId: 's', cwd: '/a', additionalDirectories: ['/c', '/b'] };
    const request = { cwd: '/a', additionalDirectories: ['/b', '/c'], mcpServers: [] };
    expect(sameWorkspace(stored, request)).toBe(true);
    expect(sameWorkspace(stored, { ...request, cwd: '/elsewhere' })).toBe(false);
  });
});

describe('whyResumeFailed', () => {
  const stored = { sessionId: 's1', cwd: '/repo', additionalDirectories: [] };
  const lists = { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { list: {} } } };
  const pages = (...sessions: string[][]) => {
    const asked: unknown[] = [];
    const ctx = {
      request: (_method: string, params: { cursor?: string }) => {
        asked.push(params);
        const index = params.cursor ? Number(params.cursor) : 0;
        return Promise.resolve({
          sessions: sessions[index]!.map((sessionId) => ({ sessionId, cwd: '/repo' })),
          nextCursor: index + 1 < sessions.length ? String(index + 1) : null,
        });
      },
    } as unknown as Parameters<typeof whyResumeFailed>[0];
    return { ctx, asked };
  };

  it('says the session is gone when the agent does not list it for that folder', async () => {
    const { ctx, asked } = pages(['other'], ['another']);
    expect(await whyResumeFailed(ctx, lists, stored)).toBe(FRESH_REASONS.gone);
    expect(asked).toEqual([{ cwd: '/repo' }, { cwd: '/repo', cursor: '1' }]);
  });

  it('says the session is still there when the agent lists it, on any page', async () => {
    const { ctx } = pages(['other'], ['s1']);
    expect(await whyResumeFailed(ctx, lists, stored)).toBe(FRESH_REASONS.listed);
  });

  it('keeps the plain reason when the agent cannot list sessions or the list fails', async () => {
    const { ctx, asked } = pages(['s1']);
    expect(await whyResumeFailed(ctx, { protocolVersion: 1 }, stored)).toBe(FRESH_REASONS.failed);
    expect(asked).toEqual([]);
    const failing = {
      request: () => Promise.reject(new Error('no')),
    } as unknown as Parameters<typeof whyResumeFailed>[0];
    expect(await whyResumeFailed(failing, lists, stored)).toBe(FRESH_REASONS.failed);
  });
});
