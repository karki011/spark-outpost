import { loadGuidePages } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { docMainHtml, fillDocTemplate } from './layout.ts';
import { renderGuideBody, type RenderContext } from './render.ts';
import { slugForPath } from './urls.ts';

function page(title: string, section: string, order: number, body = 'Text.'): string {
  return `---\ntitle: ${title}\nsection: ${section}\ntype: how-to\norder: ${order}\nsummary: About ${title} & more.\n---\n\n${body}\n`;
}

const context: RenderContext = {
  slug: 'approvals',
  slugs: new Set(['welcome', 'approvals', 'protected-paths']),
  image: (src) =>
    src === 'images/card-light.png'
      ? { light: 'card-light.png', dark: 'card-dark.png', width: 370, height: 260 }
      : null,
};

describe('renderGuideBody', () => {
  it('rewrites guide links to site pages and leaves web links alone', () => {
    const { html, problems } = renderGuideBody(
      [
        '[rules](protected-paths.md#spark-rules)',
        '[home](welcome.md)',
        '[below](#if-you-dont-answer)',
        '[same](approvals.md#if-you-dont-answer)',
        '[site](https://example.com/a)',
      ].join(' '),
      context,
    );
    expect(problems).toEqual([]);
    expect(html).toContain('href="/docs/protected-paths.html#spark-rules"');
    expect(html).toContain('href="/docs/"');
    expect(html.match(/href="#if-you-dont-answer"/g)).toHaveLength(2);
    expect(html).toContain('<a href="https://example.com/a">');
  });

  it('reports a link to a missing page or a missing image', () => {
    const { problems } = renderGuideBody('[gone](nowhere.md) ![x](images/none-light.png)', context);
    expect(problems).toEqual([
      'approvals.md links to a missing page: nowhere.md',
      'approvals.md shows a missing or non-PNG image: images/none-light.png',
    ]);
  });

  it('gives headings GitHub anchors and shows screenshots in both themes', () => {
    const { html, images } = renderGuideBody(
      "## If you don't answer\n\n## If you don't answer\n\n![A card](images/card-light.png)",
      context,
    );
    expect(html).toContain('<h2 id="if-you-dont-answer"><a href="#if-you-dont-answer">');
    expect(html).toContain('id="if-you-dont-answer-1"');
    expect(html).toContain(
      '<source srcset="/docs/images/card-dark.png" media="(prefers-color-scheme: dark)">',
    );
    expect(html).toContain('alt="A card" width="370" height="260" loading="lazy"');
    expect(images.sort()).toEqual(['card-dark.png', 'card-light.png']);
  });

  it('wraps tables in a scroll region and marks callouts', () => {
    const { html } = renderGuideBody('| A |\n| - |\n| 1 |\n\n> **Tip:** Try it.', context);
    expect(html).toContain('<div class="table-scroll" tabindex="0" role="region"');
    expect(html).toContain('<blockquote class="doc-callout doc-callout-tip">');
  });
});

describe('docMainHtml', () => {
  const pages = loadGuidePages({
    'help.md': page('Fix it', 'Help', 700),
    'second.md': page('Second', 'Get started', 120),
    'welcome.md': page('Welcome', 'Get started', 100),
    'chat.md': page('Chat', 'Chats', 200),
  });

  it('lists sections by their first order and marks the current page', () => {
    const html = docMainHtml(pages, pages[1]!, '');
    const sections = [...html.matchAll(/class="docs-section">([^<]+)</g)].map((m) => m[1]);
    expect(sections).toEqual(['Get started', 'Chats', 'Help']);
    expect(html).toContain('<a href="/docs/second.html" aria-current="page">Second</a>');
  });

  it('links previous and next within the section', () => {
    const html = docMainHtml(pages, pages[0]!, '');
    expect(html).toContain('<a class="docs-pager-next" href="/docs/second.html" rel="next">');
    expect(html).not.toContain('docs-pager-prev');
  });

  it('fills the template with an escaped title and summary', () => {
    const template =
      '<title>Docs · Spark Outpost</title><meta name="description" content="Spark Outpost user guide." /><main id="main" class="docs wrap" data-docs></main>';
    const html = fillDocTemplate(template, pages[1]!, 'BODY');
    expect(html).toContain('<title>Second · Spark Outpost docs</title>');
    expect(html).toContain('content="About Second &amp; more."');
    expect(html).toContain('data-docs>BODY</main>');
  });
});

describe('slugForPath', () => {
  it('maps the landing page and page files to slugs', () => {
    expect(slugForPath('/docs/')).toBe('welcome');
    expect(slugForPath('/docs/approvals.html')).toBe('approvals');
    expect(slugForPath('/docs/images/a.png')).toBeNull();
  });
});
