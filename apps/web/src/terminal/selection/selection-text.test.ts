import { describe, expect, it } from 'vitest';
import { cleanSelection, insertText, newChatDraft, pasteText } from './selection-text.ts';

describe('cleanSelection', () => {
  it('keeps newlines and tabs and drops every other control character', () => {
    expect(cleanSelection('a\tb\r\nc\u001b[31md\u0007\u007f\u009b\u0003e')).toBe('a\tb\nc[31mde');
  });

  it('removes a paste terminator hidden in the selection', () => {
    expect(cleanSelection('ls\u001b[201~\nrm -rf x')).toBe('ls[201~\nrm -rf x');
  });

  it('trims trailing spaces on each line and around the selection', () => {
    expect(cleanSelection('  one   \n two  \n\n\n\nthree\n')).toBe('one\n two\n\nthree');
  });

  it('is empty for whitespace and control characters alone', () => {
    expect(cleanSelection(' \u001b\n\r ')).toBe('');
  });
});

describe('insertText', () => {
  it('adds the selection as it is', () => {
    expect(insertText('add', 'pnpm check\n')).toBe('pnpm check');
  });

  it('quotes the selection and leaves a fresh line for a question', () => {
    expect(insertText('ask', 'error TS2322\nat line 4')).toBe('> error TS2322\n> at line 4\n\n');
  });

  it('puts the note after the quoted selection on one line', () => {
    expect(insertText('comment', 'error TS2322', ' fix\nthis\u001b one ')).toBe(
      '> error TS2322\n\nfix this one',
    );
  });

  it('adds the plain selection when the note is empty', () => {
    expect(insertText('comment', 'error TS2322', '  ')).toBe('error TS2322');
  });

  it('never ends with a carriage return', () => {
    for (const kind of ['add', 'ask', 'comment'] as const) {
      expect(insertText(kind, 'one\r\ntwo\r', 'note\r')).not.toContain('\r');
    }
  });

  it('inserts nothing for an empty selection', () => {
    expect(insertText('ask', ' \n ')).toBe('');
  });
});

describe('pasteText', () => {
  it('keeps the lines when the terminal has bracketed paste on', () => {
    expect(pasteText('> one\n> two\n\n', true)).toBe('> one\n> two\n\n');
  });

  it('joins the lines with spaces when it is off, so nothing is submitted', () => {
    expect(pasteText('> one\n> two\n\nnote', false)).toBe('> one > two note');
    expect(pasteText('> one\n\n', false)).toBe('> one ');
  });
});

describe('newChatDraft', () => {
  it('quotes the selection and leaves room to type', () => {
    expect(newChatDraft('one\n\ntwo')).toBe('> one\n>\n> two\n\n');
  });

  it('is empty for an empty selection', () => {
    expect(newChatDraft('\u001b')).toBe('');
  });
});
