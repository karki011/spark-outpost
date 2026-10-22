// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './html-to-markdown.ts';
import { pastedMarkdown } from './md-paste.ts';

describe('htmlToMarkdown', () => {
  it('turns rich text into Markdown', () => {
    expect(
      htmlToMarkdown(
        '<p><b>Ship blocker:</b> the <i>export</i> ignores <code>canExportAll()</code> and <s>admins</s>.</p>' +
          '<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>' +
          '<blockquote>from the review</blockquote><pre>const a = 1;\n</pre>' +
          '<p>See <a href="https://x.test/1">the ticket</a></p>',
      ),
    ).toBe(
      [
        '**Ship blocker:** the _export_ ignores `canExportAll()` and ~~admins~~.',
        '',
        '- one\n- two',
        '',
        '1. first',
        '',
        '> from the review',
        '',
        '```\nconst a = 1;\n```',
        '',
        'See [the ticket](https://x.test/1)',
      ].join('\n'),
    );
  });

  it('reads Google Docs style spans and ignores its bold wrapper', () => {
    expect(
      htmlToMarkdown(
        '<b style="font-weight:normal"><span style="font-weight:700">Bold</span> and <span style="font-style:italic">slanted</span></b>',
      ),
    ).toBe('**Bold** and _slanted_');
  });

  it('keeps only web and mail links and drops scripts, styles and images', () => {
    expect(
      htmlToMarkdown(
        '<style>p{}</style><script>alert(1)</script><a href="javascript:alert(1)">click</a> <img alt="logo" src="x.png"> <a href="mailto:a@b.test">mail</a>',
      ),
    ).toBe('click logo [mail](mailto:a@b.test)');
  });
});

describe('pastedMarkdown', () => {
  it('converts rich HTML that adds formatting', () => {
    expect(pastedMarkdown('<b>Bold</b> text', 'Bold text', ['text/html', 'text/plain'])).toBe(
      '**Bold** text',
    );
  });

  it('keeps the plain text when it is already Markdown, plain, or from a code editor', () => {
    const types = ['text/html', 'text/plain'];
    expect(pastedMarkdown('<p>- <b>a</b></p>', '- **a**', types)).toBeNull();
    expect(pastedMarkdown('<span>just words</span>', 'just words', types)).toBeNull();
    expect(pastedMarkdown('', 'plain', ['text/plain'])).toBeNull();
    expect(
      pastedMarkdown('<div><b>const</b> a</div>', 'const a', [...types, 'vscode-editor-data']),
    ).toBeNull();
  });
});
