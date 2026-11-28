import { describe, expect, it } from 'vitest';
import { GUIDE_SECTIONS, parseGuidePage } from '../packages/contracts/src/guide.ts';
import {
  checkCoverage,
  checkImages,
  checkPages,
  HEADING_CHARS_MAX,
  longestParagraph,
  NAV_CHARS_MAX,
  PARAGRAPH_WORDS_MAX,
  proseWords,
  TABLE_COLUMNS_MAX,
  tableProblems,
  TITLE_CHARS_MAX,
  WORD_CAPS,
} from './guide-rules.ts';

let nextOrder = 1;

function page(slug: string, type: string, body: string, title = slug, extra = '') {
  const order = nextOrder++;
  return parseGuidePage(
    slug,
    `---\ntitle: ${title}\n${extra}section: Chats\ntype: ${type}\norder: ${order}\nsummary: One line.\n---\n${body}`,
  );
}

const HOW_TO = `You'll do one thing. About 1 minute.

1. Select **Go**.

![The Go button](images/go-light.png)

**Next:** [other](other.md)
`;

const messages = (pages: ReturnType<typeof page>[]) =>
  checkPages(pages).map((violation) => `${violation.page}: ${violation.message}`);

describe('counting words', () => {
  it('counts prose and table cells but not table rules, images or link targets', () => {
    const body = `Two words.\n\n| A | B |\n| --- | :-: |\n| one | [two](long-page-name.md) |\n\n![alt text here](images/x-light.png)`;
    expect(proseWords(body)).toBe(6);
  });

  it('measures the longest paragraph, leaving lists, tables and code out', () => {
    const body = `one two three\nfour five\n\n- ${'word '.repeat(80)}\n\n\`\`\`\n${'code '.repeat(90)}\n\`\`\`\n\nsix`;
    expect(longestParagraph(body)).toBe(5);
  });
});

describe('page rules', () => {
  const other = page('other', 'concept', 'Short answer.');

  it('passes a how-to with a time, steps and a Next link that names its target', () => {
    expect(messages([page('go', 'how-to', HOW_TO), other])).toEqual([]);
  });

  it('asks a how-to for its time estimate, numbered steps and Next link', () => {
    expect(messages([page('go', 'how-to', 'Just prose.'), other])).toEqual([
      'go: a how-to opens with its outcome and "About N minutes."',
      'go: a how-to needs numbered steps',
      'go: ends without a **Next:** link',
    ]);
  });

  it('holds each type to its word cap and paragraphs to their limit', () => {
    const long = `${'word '.repeat(WORD_CAPS.concept + 1)}`;
    expect(messages([page('big', 'concept', long)])).toEqual([
      `big: ${WORD_CAPS.concept + 1} words; a concept page may have ${WORD_CAPS.concept}`,
      `big: a ${WORD_CAPS.concept + 1}-word paragraph; keep paragraphs to ${PARAGRAPH_WORDS_MAX}`,
    ]);
  });

  it('flags broken links, a second tip, a body title, a stale Next label and a repeated title', () => {
    const body = `# Title\n\n[gone](missing.md) and [far](other.md#nope).\n\n> **Tip:** a\n\n> **Tip:** b\n\n**Next:** [Old name](other.md)\n`;
    expect(messages([page('bad', 'concept', body, 'other'), other])).toEqual([
      'bad: has a # heading; the title comes from the frontmatter',
      'bad: more than one Tip',
      'bad: broken link missing.md',
      'bad: broken link other.md#nope',
      'bad: Next link says "Old name" but the page is titled "other"',
      'other: same title as bad',
    ]);
  });
});

describe('sidebar rules', () => {
  const longTitle = 'A title that is far too long for one sidebar row';

  it('caps the title and asks a long title for a nav label', () => {
    expect(messages([page('long', 'concept', 'Text.', longTitle)])).toEqual([
      `long: title is ${longTitle.length} characters; keep it to ${TITLE_CHARS_MAX}`,
      `long: title is ${longTitle.length} characters; add a nav label of up to ${NAV_CHARS_MAX} for the sidebar`,
    ]);
    const labelled = page('ok', 'concept', 'Text.', 'Twenty-seven characters ok.', 'nav: Short\n');
    expect(labelled.nav).toBe('Short');
    expect(messages([labelled])).toEqual([]);
  });

  it('caps the nav label and refuses one that repeats a title or another label', () => {
    const long = page('a', 'concept', 'Text.', 'A', `nav: ${'x'.repeat(NAV_CHARS_MAX + 1)}\n`);
    const same = page('b', 'concept', 'Text.', 'B', 'nav: B\n');
    const taken = page('c', 'concept', 'Text.', 'C', 'nav: A\n');
    expect(messages([long, same, taken, page('d', 'concept', 'Text.', 'A2', 'nav: A\n')])).toEqual([
      `a: nav label is ${NAV_CHARS_MAX + 1} characters; keep it to ${NAV_CHARS_MAX}`,
      'b: nav label repeats the title; leave it out',
      'd: same sidebar label as c',
    ]);
  });

  it('refuses an unknown section and a repeated order in a section', () => {
    const stray = parseGuidePage(
      'stray',
      '---\ntitle: Stray\nsection: Chatz\ntype: concept\norder: 5\nsummary: s\n---\nText.',
    );
    const first = parseGuidePage(
      'first',
      '---\ntitle: First\nsection: Chats\ntype: concept\norder: 900\nsummary: s\n---\nText.',
    );
    const second = parseGuidePage(
      'second',
      '---\ntitle: Second\nsection: Chats\ntype: concept\norder: 900\nsummary: s\n---\nText.',
    );
    expect(messages([stray, first, second])).toEqual([
      `stray: unknown section "Chatz"; sections are ${GUIDE_SECTIONS.join(', ')}`,
      'second: same order 900 as first in Chats',
    ]);
  });

  it('caps ## headings and table columns', () => {
    const heading = 'A second-level heading that runs on too long';
    const wide = '| A | B | C | D | E |\n| - | - | - | - | - |\n| 1 | 2 | 3 | 4 | 5 |';
    expect(
      messages([page('wide', 'concept', `## ${heading}\n\n### ${heading}\n\n${wide}`)]),
    ).toEqual([
      `wide: heading "${heading}" is ${heading.length} characters; keep ## headings to ${HEADING_CHARS_MAX}`,
      `wide: a table has 5 columns; keep tables to ${TABLE_COLUMNS_MAX}: | A | B | C | D | E |`,
    ]);
  });
});

describe('images and reference entries', () => {
  const pages = [page('go', 'how-to', HOW_TO), page('other', 'concept', '## Kept\n\nText.')];

  it('wants a light and dark file for each shot and no file left unshown', () => {
    expect(checkImages(pages, ['go-light.png', 'go-dark.png'])).toEqual([]);
    expect(
      checkImages(pages, ['go-light.png', 'old-light.png']).map((entry) => entry.message),
    ).toEqual(['missing image go-dark.png', 'old-light.png is not shown on any page']);
  });

  it('wants an entry for every tool or Settings section', () => {
    const reference = page('tools', 'reference', 'Use `spark_chats`.');
    expect(checkCoverage(reference, 'tools', 'Spark tool', ['`spark_chats`'])).toEqual([]);
    expect(checkCoverage(reference, 'tools', 'Spark tool', ['`spark_find`'])).toEqual([
      { page: 'tools', message: 'no entry for the Spark tool `spark_find`' },
    ]);
    expect(checkCoverage(undefined, 'tools', 'Spark tool', [])).toHaveLength(1);
  });
});

describe('tables', () => {
  const header = '| What changed | What to do |\n| --- | --- |';

  it('accepts a whole table, escaped pipes included', () => {
    expect(tableProblems(`${header}\n| One \\| two | Do it |\n| Three | Do that |`)).toEqual([]);
  });

  it('ignores table-like lines in fenced code and accepts CRLF line endings', () => {
    expect(tableProblems('```\n| Two | Do it || Three |\n```')).toEqual([]);
    expect(tableProblems(`${header}\n| One | Do it |`.replace(/\n/g, '\r\n'))).toEqual([]);
  });

  it('flags a table split by a blank line and rows fused onto one line', () => {
    const split = `${header}\n| One | Do it |\n\n| Two | Do it || Three | Do that |`;
    expect(tableProblems(split)).toEqual([
      'a table starts without a header row: | Two | Do it || Three | Do that |',
    ]);
    expect(tableProblems(`${header}\n| Two | Do it || Three | Do that |`)).toEqual([
      'a table row has 5 cells; its header has 2: | Two | Do it || Three | Do that |',
    ]);
  });
});
