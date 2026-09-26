import { describe, expect, it } from 'vitest';
import {
  TITLE_MAX_LENGTH,
  UNTITLED_CONVERSATION,
  clipAtWord,
  titleFromMessage,
} from './conversations.ts';

describe('titleFromMessage', () => {
  it('uses the first line, trimmed to the title limit', () => {
    expect(titleFromMessage('  Fix login\nwith details')).toBe('Fix login');
    expect(titleFromMessage('x'.repeat(60))).toHaveLength(TITLE_MAX_LENGTH);
  });

  it('skips leading blank lines and falls back for blank content', () => {
    expect(titleFromMessage('\n\nlater')).toBe('later');
    expect(titleFromMessage('   ')).toBe(UNTITLED_CONVERSATION);
  });
});

describe('clipAtWord', () => {
  it('keeps short text and cuts long text at a word boundary with an ellipsis', () => {
    expect(clipAtWord('  Fix login  ', 20)).toBe('Fix login');
    expect(clipAtWord('Move the date formatting in src/format.ts and the report line', 50)).toBe(
      'Move the date formatting in src/format.ts and the…',
    );
    expect(clipAtWord('abcdefghij', 5)).toBe('abcd…');
  });

  it('clips titles from a long first line without cutting a word', () => {
    const title = titleFromMessage(`${'word '.repeat(30)}end`);
    expect(title.endsWith('word…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
  });
});
