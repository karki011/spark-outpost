import { describe, expect, it } from 'vitest';
import { inlineSpans, type Span } from './md-inline.ts';
import { inCodeBlock, lineSpans, marksAt, scanLines } from './md-lines.ts';

function show(spans: readonly Span[]): string {
  return spans
    .map((span) => (span.marks.length === 0 ? span.text : `[${span.marks.join('+')}:${span.text}]`))
    .join('');
}

function inline(text: string): string {
  return show(inlineSpans(text));
}

describe('inline styling', () => {
  it('styles bold, italic, strike and code and keeps every marker as faint text', () => {
    expect(inline('a **b** c')).toBe('a [marker:**][strong:b][marker:**] c');
    expect(inline('_i_ and *j*')).toBe('[marker:_][em:i][marker:_] and [marker:*][em:j][marker:*]');
    expect(inline('~~gone~~')).toBe('[marker:~~][strike:gone][marker:~~]');
    expect(inline('run `x()` now')).toBe('run [marker:`][code:x()][marker:`] now');
  });

  it('nests emphasis and leaves code untouched inside', () => {
    expect(inline('**a _b_**')).toBe(
      '[marker:**][strong:a ][strong+marker:_][strong+em:b][strong+marker:_][marker:**]',
    );
    expect(inline('`**not bold**`')).toBe('[marker:`][code:**not bold**][marker:`]');
    expect(inline('``a ` b``')).toBe('[marker:``][code:a ` b][marker:``]');
  });

  it('styles a link label and keeps the address faint', () => {
    expect(inline('See [the ticket](https://x.test/1)')).toBe(
      'See [marker:[][link:the ticket][marker:](][marker+url:https://x.test/1][marker:)]',
    );
  });

  it('marks @handles at a word start only', () => {
    expect(inline('@dac-perms hi')).toBe('[mention:@dac-perms] hi');
    expect(inline('me@example.com')).toBe('me@example.com');
  });

  it('leaves unmatched or spaced markers and snake_case as plain text', () => {
    expect(inline('a ** b ** c')).toBe('a ** b ** c');
    expect(inline('snake_case_name')).toBe('snake_case_name');
    expect(inline('**open')).toBe('**open');
    expect(inline('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(inline('`open')).toBe('`open');
  });

  it('leaves backslash-escaped markers as plain text', () => {
    expect(inline('\\*literal\\*')).toBe('\\*literal\\*');
    expect(inline('\\*\\*not bold\\*\\*')).toBe('\\*\\*not bold\\*\\*');
    expect(inline('\\`not code\\`')).toBe('\\`not code\\`');
    expect(inline('\\[not](a link)')).toBe('\\[not](a link)');
    expect(inline('*a\\*b*')).toBe('[marker:*][em:a\\*b][marker:*]');
    expect(inline('\\\\**bold**')).toBe('\\\\[marker:**][strong:bold][marker:**]');
  });

  it('keeps the text of every span equal to the input', () => {
    const samples = ['**a _b_ `c`** [d](e) ~~f~~ @g', '***x***', '_**', '[a](b', '`` ` ``'];
    for (const sample of samples) {
      expect(
        inlineSpans(sample)
          .map((span) => span.text)
          .join(''),
      ).toBe(sample);
    }
  });
});

describe('lines', () => {
  it('tracks fenced code blocks, including one left open', () => {
    const text = 'intro\n```ts\nconst a = 1;\n```\n> quote\n- item\n1. first\n# Title\n~~~\nopen';
    expect(scanLines(text).map((line) => line.block)).toEqual([
      'text',
      'fence-open',
      'code',
      'fence-close',
      'quote',
      'list',
      'list',
      'heading',
      'fence-open',
      'code',
    ]);
  });

  it('does not style Markdown inside a code block', () => {
    expect(show(lineSpans('**not bold**', 'code'))).toBe('**not bold**');
  });

  it('fades the quote and list markers and styles the rest', () => {
    expect(show(lineSpans('> from **you**', 'quote'))).toBe(
      '[marker:>] from [marker:**][strong:you][marker:**]',
    );
    expect(show(lineSpans('  - check `x`', 'list'))).toBe(
      '  [marker:-] check [marker:`][code:x][marker:`]',
    );
    expect(show(lineSpans('## Plan', 'heading'))).toBe('[marker:##] [strong:Plan]');
  });

  it('says when the caret is inside a code block or on its opening fence', () => {
    const text = 'a\n```\ncode\n```\nb';
    expect(inCodeBlock(text, 0)).toBe(false);
    expect(inCodeBlock(text, 5)).toBe(true);
    expect(inCodeBlock(text, 8)).toBe(true);
    expect(inCodeBlock(text, 14)).toBe(false);
    expect(inCodeBlock(text, text.length)).toBe(false);
    expect(inCodeBlock('```\nstill open', 14)).toBe(true);
  });

  it('reports the styles at the caret', () => {
    expect([...marksAt('a **bold** b', 5)]).toEqual(['strong']);
    expect([...marksAt('a **bold** b', 1)]).toEqual([]);
  });

  it('styles a long draft quickly', () => {
    const line =
      'Some **bold** and _italic_ with `code`, [a link](https://x.test) and * stray _ marks\n';
    const text = line.repeat(1_000) + '*'.repeat(20_000);
    const started = performance.now();
    for (const each of scanLines(text)) lineSpans(each.text, each.block);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
