import { describe, expect, it } from 'vitest';
import { markdownToStorage, storageToText } from './confluence-format.ts';

describe('Markdown to Confluence storage', () => {
  it('writes headings, lists, quotes, code and inline marks', () => {
    const storage = markdownToStorage(
      [
        '# Plan',
        '',
        'Ship **today** with `pnpm check` and *care*.',
        '',
        '1. First',
        '2. Second',
        '',
        '> Quoted',
        '',
        '```',
        'a < b',
        '```',
        '---',
        '[Docs](https://example.test/docs)',
      ].join('\n'),
    );
    expect(storage).toBe(
      '<h1>Plan</h1><p>Ship <strong>today</strong> with <code>pnpm check</code> and <em>care</em>.</p><ol><li>First</li><li>Second</li></ol><blockquote><p>Quoted</p></blockquote><pre>a &lt; b</pre><hr /><p><a href="https://example.test/docs">Docs</a></p>',
    );
  });

  it('escapes markup and macros an agent writes, and drops unsafe links', () => {
    const storage = markdownToStorage(
      '<ac:structured-macro ac:name="html"/> & [x](javascript:alert(1)) <script>',
    );
    expect(storage).not.toContain('<ac:');
    expect(storage).not.toContain('<script');
    expect(storage).not.toContain('href="javascript');
    expect(storage).toContain('&lt;ac:structured-macro');
    expect(storage).toContain('&amp;');
  });
});

describe('Confluence storage to text', () => {
  it('reads code macros, tables, links and entities as plain text', () => {
    const text = storageToText(
      '<h3>Title</h3><p>See <a href="https://example.test">the doc</a> &mdash; ok&nbsp;now</p>' +
        '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter>' +
        '<ac:plain-text-body><![CDATA[const a = 1 < 2;]]></ac:plain-text-body></ac:structured-macro>' +
        '<table><tbody><tr><th>Name</th><td>Spark</td></tr></tbody></table>',
    );
    expect(text).toBe(
      '### Title\n\nSee [the doc](https://example.test) — ok now\n\n```\nconst a = 1 < 2;\n```\n\n | Name | Spark',
    );
  });
});
