import { describe, expect, it } from 'vitest';
import { parseDigestReply } from './parse.ts';

const KNOWN = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const MADE_UP = '00000000-0000-4000-8000-00000000dead';
const ids = new Set([KNOWN, OTHER]);

describe('parseDigestReply', () => {
  it('keeps valid lines and suggestions', () => {
    const reply = JSON.stringify({
      lines: [
        { text: 'Yesterday you refactored the date formatter.', chatId: KNOWN },
        { text: 'Today you explored invalid dates.', chatId: null },
      ],
      suggestions: [{ chatId: KNOWN, reason: '3 of 4 steps done.', draft: "Let's continue." }],
    });
    expect(parseDigestReply(reply, ids)).toEqual({
      lines: [
        { text: 'Yesterday you refactored the date formatter.', chatId: KNOWN },
        { text: 'Today you explored invalid dates.', chatId: null },
      ],
      suggestions: [{ chatId: KNOWN, reason: '3 of 4 steps done.', draft: "Let's continue." }],
      structured: true,
    });
  });

  it('drops links and suggestions for chats that were not in the input', () => {
    const reply = JSON.stringify({
      lines: [{ text: 'Something happened.', chatId: MADE_UP }],
      suggestions: [
        { chatId: MADE_UP, reason: 'Invented.', draft: 'Invented.' },
        { chatId: OTHER, reason: 'Real.', draft: 'Go on.' },
        { chatId: OTHER, reason: 'Duplicate.', draft: 'Again.' },
      ],
    });
    const body = parseDigestReply(reply, ids);
    expect(body.lines).toEqual([{ text: 'Something happened.', chatId: null }]);
    expect(body.suggestions).toEqual([{ chatId: OTHER, reason: 'Real.', draft: 'Go on.' }]);
  });

  it('accepts a fenced reply, caps counts and clips long text', () => {
    const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
      lines: Array.from({ length: 9 }, (_, index) => ({
        text: `Line ${index} ${'w'.repeat(400)}`,
      })),
      suggestions: [],
    })}\n\`\`\``;
    const body = parseDigestReply(reply, ids);
    expect(body.lines).toHaveLength(6);
    expect(body.lines[0]!.text.length).toBe(280);
    expect(body.lines[0]!.text.endsWith('…')).toBe(true);
  });

  it('falls back to plain bullets when the reply is not valid JSON', () => {
    expect(parseDigestReply('- Yesterday you fixed tests.\n- Today you read docs.\n', ids)).toEqual(
      {
        lines: [
          { text: 'Yesterday you fixed tests.', chatId: null },
          { text: 'Today you read docs.', chatId: null },
        ],
        suggestions: [],
        structured: false,
      },
    );
    expect(parseDigestReply('{"lines": "not a list"}', ids).structured).toBe(false);
  });
});
