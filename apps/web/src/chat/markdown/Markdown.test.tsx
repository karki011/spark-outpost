// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.tsx';

afterEach(cleanup);

function rendered(text: string, props: { typed?: boolean; html?: boolean } = {}): HTMLElement {
  const { container } = render(<Markdown text={text} {...props} />);
  return container.querySelector('.md')!;
}

const REPORT = [
  'Review of the landing page.',
  '',
  '<details><summary>[High] <b>SHOULD</b>: The Book Demo button has no label</summary>',
  '',
  '**Where:** `Hero.tsx:42`',
  '',
  '- Add an `aria-label`.',
  '',
  '```tsx',
  '<button aria-label="Book a demo" />',
  '```',
  '',
  '</details>',
  '',
  '<details><summary>[Low] <b>COULD</b>: Tighten copy</summary>',
  '',
  'Press <kbd>⌘</kbd><kbd>K</kbd> to search.<br>H<sub>2</sub>O and x<sup>2</sup>.',
  '',
  '</details>',
  '',
  'Done.',
].join('\n');

const ATTACKS = [
  '<script>window.hacked = true</script>',
  '<style>body { display: none }</style>',
  '<iframe src="https://evil.example">frame text</iframe>',
  '<img src=x onerror="window.hacked = true">',
  '<form action="https://evil.example"><input name="q" value="steal"><button>Go</button></form>',
  '<input type="text" value="loose input">',
  '<textarea>secret area</textarea>',
  '<svg onload="alert(1)"><script>alert(2)</script></svg>',
  '<object data="https://evil.example/x.swf">object text</object>',
  '<embed src="https://evil.example/x.swf">',
  '<base href="https://evil.example/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<link rel="stylesheet" href="https://evil.example/a.css">',
  '<p style="background:url(https://track.example/a.png)" onclick="alert(1)">styled</p>',
  '<details ontoggle="alert(1)"><summary onfocus="alert(1)">Fold</summary>inside</details>',
  '<a href="javascript:alert(1)">raw script</a>',
  '<a href="file:///etc/passwd">file link</a>',
  '<a href="data:text/html,hi">data link</a>',
  '<a href="https://example.com" onmouseover="alert(1)" ping="https://track.example">web</a>',
  '[md script](javascript:alert(1))',
  '[md file](file:///Users/me/.ssh/id_rsa)',
];

describe('Markdown inline HTML', () => {
  it('renders a review report with folds that keep their markdown and start closed', () => {
    const root = rendered(REPORT);
    const folds = root.querySelectorAll('details');
    expect(folds).toHaveLength(2);
    expect([...folds].map((fold) => fold.open)).toEqual([false, false]);
    expect(folds[0]!.querySelector('summary b')?.textContent).toBe('SHOULD');
    expect(folds[0]!.querySelector('strong')?.textContent).toBe('Where:');
    expect(folds[0]!.querySelector('li code')?.textContent).toBe('aria-label');
    expect(folds[0]!.querySelector('.md-code code')?.textContent).toBe(
      '<button aria-label="Book a demo" />',
    );
    for (const tag of ['kbd', 'br', 'sub', 'sup']) {
      expect(folds[1]!.querySelector(tag), tag).not.toBeNull();
    }
    expect(root.textContent).not.toContain('<details>');
    expect(root.textContent).not.toContain('<b>');
    fireEvent.click(folds[0]!.querySelector('summary')!);
    expect(folds[0]!.open).toBe(true);
  });

  it('neutralises scripts, handlers, frames, forms and unsafe links', () => {
    const root = rendered(['Before', '', ...ATTACKS, '', 'After'].join('\n\n'));
    expect(
      root.querySelector(
        'script, style, iframe, img, form, textarea, svg, object, embed, base, meta, link, button',
      ),
    ).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    const attributes = [...root.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.name),
    );
    expect(attributes.filter((name) => /^on|^style$|^ping$|^src$|^action$/.test(name))).toEqual([]);
    expect([...root.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com',
    ]);
    expect(root.textContent).not.toMatch(/hacked|display: none|frame text|secret area|alert/);
    expect(root.textContent).not.toMatch(/steal|object text/);
    expect(root.textContent).toContain('Before');
    expect(root.textContent).toContain('After');
    expect(root.textContent).toContain('file link');
  });

  it('keeps web and mail links on the shared link component and task list boxes', () => {
    const root = rendered(
      [
        '[web](https://example.com/a) <a href="mailto:a@example.com">mail</a> [rel](/api/x)',
        '',
        '- [x] done',
        '- [ ] open',
      ].join('\n'),
    );
    const links = [...root.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com/a',
      'mailto:a@example.com',
    ]);
    expect(links.every((link) => link.target === '_blank' && link.rel.includes('noopener'))).toBe(
      true,
    );
    expect(root.querySelector('.md-link-off')?.textContent).toBe('rel');
    const boxes = root.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]');
    expect([...boxes].map((box) => [box.checked, box.disabled])).toEqual([
      [true, true],
      [false, true],
    ]);
  });

  it('keeps links whose scheme is in capitals and still drops unsafe ones', () => {
    const root = rendered(
      '[a](HTTPS://example.com/Path) <a href="MailTo:a@example.com">m</a> [x](JAVASCRIPT:alert(1))',
    );
    expect([...root.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com/Path',
      'mailto:a@example.com',
    ]);
    expect(root.querySelector('.md-link-off')?.textContent).toBe('x');
  });

  it('shows HTML preformatted code as a block, keeping nested text', () => {
    const root = rendered(
      '<pre><code>a    b</code></pre>\n\n<pre><code>const <b>token</b> = 1;</code></pre>',
    );
    const blocks = [...root.querySelectorAll('.md-code .md-pre')].map((block) => block.textContent);
    expect(blocks).toEqual(['a    b', 'const token = 1;']);
  });

  it('never loads an image from markdown or HTML', () => {
    const root = rendered(
      '![chart](https://track.example/c.png)\n\n<img src="https://track.example/p.gif" alt="pixel">',
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root.innerHTML).not.toContain('track.example');
    expect([...root.querySelectorAll('.md-image-off')].map((n) => n.textContent)).toEqual([
      'Image not loaded: chart',
      'Image not loaded: pixel',
    ]);
  });

  it('keeps HTML literal in typed messages and where html is off', () => {
    for (const props of [{ typed: true }, { html: false }]) {
      const root = rendered(
        '<details><summary>Fold</summary>\n\n<!-- hidden -->\n\n</details>',
        props,
      );
      expect(root.querySelector('details')).toBeNull();
      expect(root.textContent).toContain('<summary>Fold</summary>');
      expect(root.textContent).toContain('<!-- hidden -->');
      cleanup();
    }
  });
});

describe('Markdown inline HTML while streaming', () => {
  it('keeps an unclosed fold mounted and open as more text arrives', () => {
    const start = '<details><summary>[High] Finding</summary>\n\nFirst para';
    const { container, rerender } = render(<Markdown text={start} streaming />);
    const fold = container.querySelector('details')!;
    expect(fold.open).toBe(false);
    fireEvent.click(fold.querySelector('summary')!);
    expect(fold.open).toBe(true);
    for (const more of [
      '\n\nSecond **bo',
      '\n\nSecond **bold** para\n\n- item',
      '\n\n</details>',
    ]) {
      rerender(<Markdown text={start + more} streaming />);
      expect(container.querySelector('details')).toBe(fold);
      expect(fold.open).toBe(true);
    }
    rerender(<Markdown text={`${start}\n\n</details>\n\nAfter.`} streaming={false} />);
    expect(container.querySelector('details')).toBe(fold);
    expect(fold.open).toBe(true);
    expect(fold.textContent).toContain('First para');
  });

  it('leaves an earlier fold untouched while later text streams', () => {
    const first = '<details><summary>One</summary>\n\nBody one\n\n</details>\n\n';
    const { container, rerender } = render(<Markdown text={`${first}Next`} streaming />);
    const fold = container.querySelector('details')!;
    fireEvent.click(fold.querySelector('summary')!);
    rerender(<Markdown text={`${first}Next words\n\n<details><summary>Two`} streaming />);
    rerender(
      <Markdown text={`${first}Next words\n\n<details><summary>Two</summary>\n\nx`} streaming />,
    );
    const folds = container.querySelectorAll('details');
    expect(folds[0]).toBe(fold);
    expect(fold.open).toBe(true);
    expect(folds[1]!.open).toBe(false);
  });

  it('renders a half-written tag without throwing or showing it', () => {
    for (const text of [
      'Intro <deta',
      '<details><summ',
      '<details><summary>x',
      '<b>SHO',
      '</detai',
    ]) {
      const { container } = render(<Markdown text={text} streaming />);
      expect(container.textContent).not.toMatch(/<\/?[a-z]/i);
      cleanup();
    }
  });
});
