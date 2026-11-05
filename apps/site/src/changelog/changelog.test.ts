import { describe, expect, it } from 'vitest';
import { inlineMarkdown, parseChangelog, releasesHtml } from './changelog.ts';

const SAMPLE = `# Spark Outpost changelog

Newest first.

## 0.1.0-beta.2

- Calendar: Scout lowers a card.
- Fixes: \`pnpm dev\` works
  across lines.

## 0.1.0-beta.1

## 0.1.0-beta.0

- First build.
`;

describe('parseChangelog', () => {
  it('reads each release with its notes, newest first, joining wrapped lines', () => {
    expect(parseChangelog(SAMPLE)).toEqual([
      {
        version: '0.1.0-beta.2',
        notes: ['Calendar: Scout lowers a card.', 'Fixes: `pnpm dev` works across lines.'],
      },
      { version: '0.1.0-beta.0', notes: ['First build.'] },
    ]);
  });

  it('ignores text before the first release heading', () => {
    expect(parseChangelog('- stray\n## 1.0.0\n- one')).toEqual([
      { version: '1.0.0', notes: ['one'] },
    ]);
  });
});

describe('releasesHtml', () => {
  it('escapes HTML and keeps code and bold', () => {
    expect(inlineMarkdown('<b> & `a<b` **Join**')).toBe(
      '&lt;b&gt; &amp; <code>a&lt;b</code> <strong>Join</strong>',
    );
  });

  it('gives each release an anchor and tags the area before a colon', () => {
    const html = releasesHtml([{ version: '0.1.0-beta.2', notes: ['Calendar: Join.', 'Plain.'] }]);
    expect(html).toContain('id="v0.1.0-beta.2"');
    expect(html).toContain('<span class="note-area">Calendar</span> Join.');
    expect(html).toContain('<li>Plain.</li>');
  });
});
