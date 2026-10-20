import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { agendaMarkdown } from './agenda-markdown.ts';

function html(agenda: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { skipHtml: true }, agendaMarkdown(agenda)),
  );
}

describe('agendaMarkdown', () => {
  it('renders lines, bullets and an https link from converted notes', () => {
    const agenda = [
      'Setting aside 15 minutes.',
      '',
      'Run through these topics:',
      '• What did you do yesterday?',
      '• Any blockers?',
      'Link to board: https://acme.atlassian.net/jira/boards/1.',
    ].join('\n');
    expect(html(agenda)).toBe(
      '<p>Setting aside 15 minutes.</p>\n' +
        '<p>Run through these topics:</p>\n' +
        '<ul>\n<li>What did you do yesterday?</li>\n<li>Any blockers?</li>\n</ul>\n' +
        '<p>Link to board: <a href="https://acme.atlassian.net/jira/boards/1">https://acme.atlassian.net/jira/boards/1</a>.</p>',
    );
  });

  it('keeps line breaks inside a paragraph', () => {
    expect(html('Hi team,\nPlease review')).toBe('<p>Hi team,<br/>\nPlease review</p>');
  });

  it('nests and numbers lists', () => {
    expect(html(['1. Intro', '  • Names', '2. Demo'].join('\n'))).toBe(
      '<ol>\n<li>Intro\n<ul>\n<li>Names</li>\n</ul>\n</li>\n<li>Demo</li>\n</ol>',
    );
  });

  it('shows Markdown and HTML typed into plain notes as text', () => {
    const agenda =
      '# Not a heading\n**not bold** _x_ ![img](https://x.example/p.png) [a](https://evil.example)\n<img src=x onerror=alert(1)> &amp; - not a list\n> quote';
    const out = html(agenda);
    expect(out).not.toMatch(/<(h1|strong|em|img|blockquote|ul)\b/);
    expect(out).toContain('![img] <a href="https://x.example/p.png">https://x.example/p.png</a>');
    expect(out).toContain('[a] <a href="https://evil.example/">https://evil.example/</a>');
    expect(out).toContain('# Not a heading');
    expect(out).toContain('**not bold** _x_');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt; &amp;amp; - not a list');
  });

  it('links only https addresses', () => {
    const out = html('see http://plain.example.com and javascript:alert(1) and www.example.com');
    expect(out).not.toContain('<a ');
  });

  it('keeps phone numbers as text for the panel to offer copying', () => {
    expect(html('+1 312 626 6799 US (Chicago)')).toBe('<p>+1 312 626 6799 US (Chicago)</p>');
  });
});
