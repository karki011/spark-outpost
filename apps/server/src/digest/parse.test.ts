import { describe, expect, it } from 'vitest';
import type { DigestStats } from '@spark-outpost/contracts';
import { parseDigestReply } from './parse.ts';

const KNOWN = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const MADE_UP = '00000000-0000-4000-8000-00000000dead';
const ids = new Set([KNOWN, OTHER]);
const stats: DigestStats = { finished: 1, waiting: 0, failedOrStalled: 1, costUsd: 0.5 };

describe('parseDigestReply', () => {
  it('keeps valid lines, suggestions and headline', () => {
    const reply = JSON.stringify({
      headline: 'The refactor landed and one chat needs your answer.',
      lines: [
        { text: 'Yesterday you refactored the date formatter.', chatId: KNOWN },
        { text: 'Today you explored invalid dates.', chatId: null },
      ],
      suggestions: [{ chatId: KNOWN, reason: '3 of 4 steps done.', draft: "Let's continue." }],
    });
    expect(parseDigestReply(reply, ids, stats)).toEqual({
      headline: 'The refactor landed and one chat needs your answer.',
      lines: [
        { text: 'Yesterday you refactored the date formatter.', chatId: KNOWN },
        { text: 'Today you explored invalid dates.', chatId: null },
      ],
      suggestions: [{ chatId: KNOWN, reason: '3 of 4 steps done.', draft: "Let's continue." }],
      structured: true,
    });
  });

  it('falls back to a deterministic headline when the model omits or botches it', () => {
    const missing = JSON.stringify({
      lines: [{ text: 'Something happened.', chatId: null }],
      suggestions: [],
    });
    expect(parseDigestReply(missing, ids, stats).headline).toBe(
      '1 chat finished, 1 chat failed or stalled, $0.50 spent.',
    );

    const tooLong = JSON.stringify({
      headline: 'w'.repeat(200),
      lines: [{ text: 'Something happened.', chatId: null }],
      suggestions: [],
    });
    expect(parseDigestReply(tooLong, ids, stats).headline).toBe(
      '1 chat finished, 1 chat failed or stalled, $0.50 spent.',
    );

    const blank = JSON.stringify({
      headline: '   ',
      lines: [{ text: 'Something happened.', chatId: null }],
      suggestions: [],
    });
    expect(parseDigestReply(blank, ids, stats).headline).toBe(
      '1 chat finished, 1 chat failed or stalled, $0.50 spent.',
    );
  });

  it('drops links and suggestions for chats that were not in the input', () => {
    const reply = JSON.stringify({
      headline: 'Quiet day.',
      lines: [{ text: 'Something happened.', chatId: MADE_UP }],
      suggestions: [
        { chatId: MADE_UP, reason: 'Invented.', draft: 'Invented.' },
        { chatId: OTHER, reason: 'Real.', draft: 'Go on.' },
        { chatId: OTHER, reason: 'Duplicate.', draft: 'Again.' },
      ],
    });
    const body = parseDigestReply(reply, ids, stats);
    expect(body.lines).toEqual([{ text: 'Something happened.', chatId: null }]);
    expect(body.suggestions).toEqual([{ chatId: OTHER, reason: 'Real.', draft: 'Go on.' }]);
  });

  it('accepts a fenced reply, caps counts and clips long text', () => {
    const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
      headline: 'Quiet day.',
      lines: Array.from({ length: 9 }, (_, index) => ({
        text: `Line ${index} ${'w'.repeat(400)}`,
      })),
      suggestions: [],
    })}\n\`\`\``;
    const body = parseDigestReply(reply, ids, stats);
    expect(body.lines).toHaveLength(6);
    expect(body.lines[0]!.text.length).toBe(280);
    expect(body.lines[0]!.text.endsWith('…')).toBe(true);
  });

  it('falls back to plain bullets and a deterministic headline when the reply is not valid JSON', () => {
    expect(
      parseDigestReply('- Yesterday you fixed tests.\n- Today you read docs.\n', ids, stats),
    ).toEqual({
      headline: '1 chat finished, 1 chat failed or stalled, $0.50 spent.',
      lines: [
        { text: 'Yesterday you fixed tests.', chatId: null },
        { text: 'Today you read docs.', chatId: null },
      ],
      suggestions: [],
      structured: false,
    });
    expect(parseDigestReply('{"lines": "not a list"}', ids, stats).structured).toBe(false);
  });
});
