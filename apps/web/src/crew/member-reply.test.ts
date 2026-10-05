import { describe, expect, it } from 'vitest';
import { memberReply, memberReplyText, piecesNoticeText } from './member-reply.ts';

const piece = (key: string) => ({
  key,
  title: `Piece ${key}`,
  goal: 'Build it',
  owns: [`${key}.ts`],
  reads: [],
  dependsOn: [],
  contract: 'none',
  acceptance: ['works'],
});
const BLOCK = JSON.stringify({ pieces: [piece('P1'), piece('P2'), piece('P3')] }, null, 2);
const FENCE = '```';
const fenced = (tag: string, body = BLOCK) => `${FENCE}${tag}\n${body}\n${FENCE}`;

function everyPrefix(text: string): string[] {
  return Array.from({ length: text.length + 1 }, (_, length) => text.slice(0, length));
}

describe('memberReply for the Coordinator', () => {
  it('replaces a finished pieces block with a count and keeps the prose around it', () => {
    const reply = memberReply(
      'coordinator',
      `Here is the split.\n\n${fenced('pieces')}\n\nDone.`,
      false,
    );
    expect(reply).toEqual({
      before: 'Here is the split.',
      after: 'Done.',
      notice: { state: 'ready', count: 3 },
    });
  });

  it('shows a placeholder as soon as the fence opens', () => {
    for (const text of ['Splitting.\n\n```', 'Splitting.\n\n```pie', 'Splitting.\n\n```pieces\n']) {
      expect(memberReply('coordinator', text, true)).toEqual({
        before: 'Splitting.',
        after: '',
        notice: { state: 'writing', count: 0 },
      });
    }
  });

  it('counts the pieces written so far in partial JSON', () => {
    const cut = BLOCK.indexOf('"key": "P3"');
    const reply = memberReply('coordinator', `${FENCE}pieces\n${BLOCK.slice(0, cut)}`, true);
    expect(reply.notice).toEqual({ state: 'writing', count: 2 });
    expect(piecesNoticeText(reply.notice!)).toBe(
      'Splitting the work into pieces… 2 pieces so far.',
    );
  });

  it('never lets a JSON key through at any point of the stream', () => {
    const replies = [
      `Here is the split.\n\n${fenced('pieces')}\n\nThat is all.`,
      fenced('json'),
      fenced(''),
      BLOCK,
    ];
    for (const reply of replies) {
      for (const prefix of everyPrefix(reply)) {
        const shown = memberReplyText('coordinator', prefix, true);
        expect(shown).not.toContain('"key"');
        expect(shown).not.toContain('dependsOn');
        expect(shown).not.toContain(FENCE);
      }
    }
  });

  it('treats the block the server would parse as the pieces block', () => {
    expect(memberReply('coordinator', fenced('json'), false).notice).toEqual({
      state: 'ready',
      count: 3,
    });
    expect(memberReply('coordinator', BLOCK, false).notice).toEqual({ state: 'ready', count: 3 });
    const tagged = `${fenced('pieces')}\n\n${fenced('ts', 'const a = 1;')}`;
    expect(memberReply('coordinator', tagged, false)).toEqual({
      before: '',
      after: fenced('ts', 'const a = 1;'),
      notice: { state: 'ready', count: 3 },
    });
  });

  it('says so when a settled block is not a piece list', () => {
    const cut = `${FENCE}pieces\n${BLOCK.slice(0, 80)}`;
    expect(memberReply('coordinator', cut, false).notice).toEqual({
      state: 'unreadable',
      count: 0,
    });
    expect(memberReply('coordinator', fenced('pieces', '{}'), false).notice?.state).toBe(
      'unreadable',
    );
    expect(memberReplyText('coordinator', cut, false)).toBe('The piece list could not be read.');
  });

  it('leaves prose and code that cannot be a piece list alone', () => {
    const prose = 'I could not split this: the request is one change.';
    expect(memberReply('coordinator', prose, false)).toEqual({
      before: prose,
      after: '',
      notice: null,
    });
    const code = `Look at this:\n\n${fenced('ts', 'const a = 1;')}`;
    expect(memberReply('coordinator', code, false).notice).toBeNull();
    expect(memberReplyText('coordinator', code, true)).toBe(code);
  });
});

describe('memberReply for everyone else', () => {
  it('never touches another role, even when it prints a pieces block', () => {
    const text = `Here is the JSON.\n\n${fenced('pieces')}`;
    for (const role of ['builder', 'critic', 'integrator', 'scout', 'jev', null]) {
      expect(memberReply(role, text, true)).toEqual({ before: text, after: '', notice: null });
      expect(memberReplyText(role, fenced('json'), false)).toBe(fenced('json'));
    }
  });
});

describe('memberReplyText', () => {
  it('drops the clarify block a Reader ends its questions with, open or closed', () => {
    const questions = '1. Which page?';
    const block = `${FENCE}clarify\n{"questions":[{"question":"Which page?","default":"Home"}]}`;
    expect(memberReplyText('scout', `${questions}\n\n${block}`, true)).toBe(questions);
    expect(memberReplyText('scout', `${questions}\n\n${block}\n${FENCE}`, false)).toBe(questions);
  });
});

describe('piecesNoticeText', () => {
  it('reads as one calm line in each state', () => {
    expect(piecesNoticeText({ state: 'writing', count: 0 })).toBe(
      'Splitting the work into pieces…',
    );
    expect(piecesNoticeText({ state: 'writing', count: 1 })).toBe(
      'Splitting the work into pieces… 1 piece so far.',
    );
    expect(piecesNoticeText({ state: 'ready', count: 1 })).toBe('Split the work into 1 piece.');
    expect(piecesNoticeText({ state: 'ready', count: 3 })).toBe('Split the work into 3 pieces.');
  });
});
