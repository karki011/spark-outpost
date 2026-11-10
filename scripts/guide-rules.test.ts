import { describe, expect, it } from 'vitest';
import { parseGuidePage } from '../packages/contracts/src/guide.ts';
import {
  checkCoverage,
  checkImages,
  checkPages,
  longestParagraph,
  PARAGRAPH_WORDS_MAX,
  proseWords,
  tableProblems,
  WORD_CAPS,
} from './guide-rules.ts';

function page(slug: string, type: string, body: string, title = slug) {
  return parseGuidePage(
    slug,
    `---\ntitle: ${title}\nsection: Chats\ntype: ${type}\norder: 1\nsummary: One line.\n---\n${body}`,
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
