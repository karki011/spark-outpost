import { describe, expect, it } from 'vitest';
import { adfToText, textToAdf } from './jira-adf.ts';

describe('Jira document format', () => {
  it('turns ADF into readable text', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goal' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ask ' },
            { type: 'mention', attrs: { text: '@Sam' } },
            { type: 'hardBreak' },
            { type: 'text', text: 'today' },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'pnpm test' }] },
      ],
    };
    expect(adfToText(doc)).toBe(
      '## Goal\n\nAsk @Sam\ntoday\n\n1. one\n2. two\n\n```\npnpm test\n```',
    );
    expect(adfToText(null)).toBe('');
    expect(adfToText('plain')).toBe('plain');
  });

  it('turns text into ADF paragraphs', () => {
    expect(textToAdf('Hello\nthere\n\nBye')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'hardBreak' },
            { type: 'text', text: 'there' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Bye' }] },
      ],
    });
  });
});
