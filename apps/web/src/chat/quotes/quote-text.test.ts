import { describe, expect, it } from 'vitest';
import {
  LEAD_IN_EARLIER,
  LEAD_IN_LATEST,
  composeMessage,
  leadIn,
  normalizeQuote,
  quotePreview,
  sendLabel,
  splitQuoted,
} from './quote-text.ts';

describe('composeMessage', () => {
  it('puts the lead-in, each quote and its note before the typed text', () => {
    const content = composeMessage(
      [
        { text: 'Run the migration first.', note: '' },
        { text: 'Line one\n\nLine two', note: '  Why two lines?  ' },
      ],
      'Can you explain?',
      LEAD_IN_LATEST,
    );
    expect(content).toBe(
      [
        LEAD_IN_LATEST,
        '> Run the migration first.',
        '> Line one\n>\n> Line two',
        'Why two lines?',
        'Can you explain?',
      ].join('\n\n'),
    );
  });

  it('sends quotes alone when nothing is typed', () => {
    expect(composeMessage([{ text: 'Only this', note: 'Hmm' }], '   ', LEAD_IN_EARLIER)).toBe(
      `${LEAD_IN_EARLIER}\n\n> Only this\n\nHmm`,
    );
  });

  it('leaves a message without quotes untouched', () => {
    expect(composeMessage([], '  as typed ', LEAD_IN_LATEST)).toBe('  as typed ');
  });
});

describe('splitQuoted', () => {
  it('reads back what composeMessage wrote', () => {
    const content = composeMessage(
      [
        { text: 'First\n\nsecond paragraph', note: 'A note' },
        { text: 'Another', note: '' },
      ],
      'Question?',
      LEAD_IN_LATEST,
    );
    expect(splitQuoted(content)).toEqual([
      { kind: 'lead', text: LEAD_IN_LATEST },
      { kind: 'quote', text: 'First\n\nsecond paragraph' },
      { kind: 'text', text: 'A note' },
      { kind: 'quote', text: 'Another' },
      { kind: 'text', text: 'Question?' },
    ]);
  });

  it('keeps plain messages as a single text segment', () => {
    expect(splitQuoted('Hello\nthere')).toEqual([{ kind: 'text', text: 'Hello\nthere' }]);
  });

  it('does not treat a lone lead-in sentence as a lead-in', () => {
    expect(splitQuoted(LEAD_IN_LATEST)).toEqual([{ kind: 'text', text: LEAD_IN_LATEST }]);
  });
});

describe('leadIn', () => {
  it('names the previous reply only when every quote comes from it', () => {
    expect(leadIn(['reply-2', 'reply-2'], 'reply-2')).toBe(LEAD_IN_LATEST);
    expect(leadIn(['reply-1', 'reply-2'], 'reply-2')).toBe(LEAD_IN_EARLIER);
    expect(leadIn([null], 'reply-2')).toBe(LEAD_IN_EARLIER);
    expect(leadIn(['reply-2'], null)).toBe(LEAD_IN_EARLIER);
  });
});

describe('sendLabel', () => {
  it('counts what will be sent', () => {
    expect(sendLabel([])).toBe('Send');
    expect(sendLabel(['comment'])).toBe('Send 1 comment');
    expect(sendLabel(['comment', 'comment', 'comment'])).toBe('Send 3 comments');
    expect(sendLabel(['ask', 'ask'])).toBe('Send 2 questions');
    expect(sendLabel(['quote', 'ask'])).toBe('Send 2 comments');
  });
});

describe('quote text cleanup', () => {
  it('normalizes selected text', () => {
    expect(normalizeQuote('  a b  \r\n\r\n\r\n\r\nc\t \n')).toBe('a b\n\nc');
  });

  it('previews long quotes on one line', () => {
    expect(quotePreview('short\ntext')).toBe('short text');
    const preview = quotePreview('word '.repeat(40));
    expect(preview.length).toBeLessThanOrEqual(80);
    expect(preview.endsWith('…')).toBe(true);
  });
});
