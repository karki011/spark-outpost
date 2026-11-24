import { describe, expect, it } from 'vitest';
import { loadGuidePages } from './guide.ts';
import { parseWhatsNewEntry, whatsNewBody } from './guide-whats-new.ts';

const PAGE =
  "---\ntitle: What's new\nsection: Help\ntype: whats-new\norder: 720\nsummary: s\n---\n";

function entry(name: string, change: string, extra = '') {
  return parseWhatsNewEntry(`whats-new/${name}.md`, `change: ${change}\n${extra}`);
}

describe('a what’s new entry', () => {
  it('takes its section from the date in its name and has nothing to do by default', () => {
    expect(entry('2026-11-04-faster', 'Faster')).toEqual({
      name: '2026-11-04-faster',
      section: '4 November 2026',
      change: 'Faster',
      todo: '—',
    });
  });

  it('keeps its own section and what to do', () => {
    const parsed = entry(
      '2026-11-04-hello',
      'Windows Hello',
      'section: Windows\ndo: [Keys](k.md).',
    );
    expect(parsed.section).toBe('Windows');
    expect(parsed.todo).toBe('[Keys](k.md).');
  });

  it('is refused without a dated name or a change', () => {
    expect(() => parseWhatsNewEntry('whats-new/faster.md', 'change: Faster')).toThrow(/YYYY-MM-DD/);
    expect(() => parseWhatsNewEntry('whats-new/2026-11-04-faster.md', 'do: x')).toThrow(/change/);
    expect(() => parseWhatsNewEntry('whats-new/2026-13-04-faster.md', 'change: x')).toThrow(
      /month/,
    );
  });
});

describe('the what’s new page', () => {
  it('lists entries newest first, one table per section', () => {
    const body = whatsNewBody([
      entry('2026-11-03-old', 'Old'),
      entry('2026-11-04-b', 'Second', 'do: [B](b.md).'),
      entry('2026-11-04-c', 'First'),
    ]);
    expect(body).toBe(
      [
        '## 4 November 2026',
        '',
        '| What changed | What to do |',
        '| --- | --- |',
        '| First | — |',
        '| Second | [B](b.md). |',
        '',
        '## 3 November 2026',
        '',
        '| What changed | What to do |',
        '| --- | --- |',
        '| Old | — |',
      ].join('\n'),
    );
  });

  it('drops the oldest entries that do not fit the word cap', () => {
    const entries = [
      entry('2026-11-03-old', 'one two three'),
      entry('2026-11-04-new', 'four five six'),
    ];
    const body = whatsNewBody(entries, 12);
    expect(body).toContain('four five six');
    expect(body).not.toContain('one two three');
  });

  it('keeps a pipe in an entry inside its cell', () => {
    expect(whatsNewBody([entry('2026-11-04-pipe', 'a | b')])).toContain('| a \\| b | — |');
  });

  it('is built by the loader from the entry files beside the page', () => {
    const pages = loadGuidePages({
      '../docs/guide/whats-new.md': PAGE,
      '../docs/guide/whats-new/2026-11-04-faster.md': 'change: Faster\n',
      '../docs/guide/other.md': PAGE.replace("What's new", 'Other').replace('whats-new', 'how-to'),
    });
    expect(pages.map((page) => page.slug).sort()).toEqual(['other', 'whats-new']);
    const page = pages.find((entry) => entry.slug === 'whats-new');
    expect(page?.headings.map((heading) => heading.text)).toEqual(['4 November 2026']);
    expect(page?.body).toContain('| Faster | — |');
  });
});
