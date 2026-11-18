// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewMarkdown } from './ReviewMarkdown.tsx';

afterEach(cleanup);

function rendered(text: string): HTMLElement {
  const { container } = render(<ReviewMarkdown text={text} />);
  return container.querySelector('.md-review')!;
}

const ATTRIBUTE_ATTACKS = [
  '<a href="https://example.com" onclick="alert(1)" ping="https://track.example">link</a>',
  '<p style="background:url(https://track.example/a.png)">styled</p>',
  '<table background="https://track.example/t.png"><tr><td>cell</td></tr></table>',
  '<details ontoggle="alert(1)" open><summary onclick="alert(1)">Fold</summary>x</details>',
];

describe('ReviewMarkdown', () => {
  it('keeps details folds with markdown inside them and toggles them', () => {
    const root = rendered(
      [
        '<details><summary>🟡 <b>SHOULD:</b> Retries never stop</summary>',
        '',
        '**Verdict:** introduced by this PR.',
        '',
        '- `worker.ts:88` requeues first.',
        '',
        '</details>',
        '',
        '<details open><summary>Open fold</summary>',
        '',
        'Shown',
        '',
        '</details>',
      ].join('\n'),
    );
    const folds = root.querySelectorAll('details');
    expect(folds).toHaveLength(2);
    expect(folds[0]!.open).toBe(false);
    expect(folds[1]!.open).toBe(true);
    expect(folds[0]!.querySelector('summary b')?.textContent).toBe('SHOULD:');
    expect(folds[0]!.querySelector('strong')?.textContent).toBe('Verdict:');
    expect(folds[0]!.querySelector('li code')?.textContent).toBe('worker.ts:88');
    fireEvent.click(folds[0]!.querySelector('summary')!);
    expect(folds[0]!.open).toBe(true);
  });

  it('keeps the GitHub inline HTML subset', () => {
    const root = rendered(
      'Press <kbd>⌘</kbd> H<sub>2</sub>O x<sup>2</sup><br>next <i>a</i> <em>b</em> <strong>c</strong>',
    );
    for (const tag of ['kbd', 'sub', 'sup', 'br', 'i', 'em', 'strong']) {
      expect(root.querySelector(tag), tag).not.toBeNull();
    }
  });

  it('removes scripts, styles, frames and forms with their content', () => {
    const root = rendered(
      [
        'Before',
        '',
        '<script>window.hacked = true</script>',
        '<style>body { display: none }</style>',
        '<iframe src="https://evil.example">frame text</iframe>',
        '<form action="https://evil.example"><input name="q"><button>Go</button></form>',
        '<textarea>secret area</textarea>',
        '<svg><script>alert(1)</script></svg>',
        '<base href="https://evil.example/">',
        '<meta http-equiv="refresh" content="0;url=https://evil.example">',
        '',
        'After',
      ].join('\n'),
    );
    expect(root.querySelector('script, style, iframe, form, textarea, svg, base, meta')).toBeNull();
    expect(root.querySelector('input:not([type="checkbox"])')).toBeNull();
    expect(root.textContent).not.toMatch(/hacked|display: none|frame text|secret area|alert/);
    expect(root.textContent).toContain('Before');
    expect(root.textContent).toContain('After');
  });

  it('removes event handlers, styles and tracking attributes', () => {
    const root = rendered(ATTRIBUTE_ATTACKS.join('\n\n'));
    const attributes = [...root.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.name),
    );
    expect(attributes.filter((name) => /^on|^style$|^ping$|^background$/.test(name))).toEqual([]);
    expect(root.querySelector('details')?.open).toBe(true);
    expect(root.textContent).toContain('cell');
  });

  it('turns non-web links into plain text and opens web links in a new window', () => {
    const root = rendered(
      [
        '[script](javascript:alert(1))',
        '<a href="javascript:alert(1)">raw script</a>',
        '<a href="data:text/html,hi">data</a>',
        '[mail](mailto:a@example.com)',
        '[relative](/api/settings)',
        '[web](https://github.com/acme/api/pull/412)',
      ].join('\n\n'),
    );
    const links = [...root.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://github.com/acme/api/pull/412',
    ]);
    expect(links[0]!.target).toBe('_blank');
    expect(links[0]!.rel).toContain('noopener');
    expect(root.querySelectorAll('.md-link-off')).toHaveLength(5);
  });

  it('never loads images', () => {
    const root = rendered(
      [
        '![chart](https://track.example/chart.png)',
        '<img src="https://track.example/pixel.gif" alt="pixel">',
        '<img srcset="https://track.example/a.png 2x" alt="set">',
        '<picture><source srcset="https://track.example/p.png"><img src="https://track.example/q.png"></picture>',
        '<input type="image" src="https://track.example/i.png">',
      ].join('\n\n'),
    );
    expect(root.querySelector('img, picture, source, input')).toBeNull();
    expect(root.innerHTML).not.toContain('track.example');
    expect(root.querySelector('.md-image-off')?.textContent).toBe('Image not loaded: chart');
  });

  it('still renders GFM tables, task lists and code fences', () => {
    const root = rendered(
      [
        '| Gate | Result |',
        '| :-- | --: |',
        '| CI | green |',
        '',
        '- [x] done',
        '- [ ] open',
        '',
        '```ts',
        'const a = 1;',
        '```',
      ].join('\n'),
    );
    expect(root.querySelector('.md-table th')?.textContent).toBe('Gate');
    expect(root.querySelector('td')?.textContent).toBe('CI');
    const boxes = root.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]');
    expect([...boxes].map((box) => [box.checked, box.disabled])).toEqual([
      [true, true],
      [false, true],
    ]);
    expect(root.querySelector('.md-code figcaption')?.textContent).toContain('ts');
    expect(root.querySelector('.md-code code')?.textContent).toBe('const a = 1;');
  });

  it('keeps line breaks in a raw pre block', () => {
    const root = rendered('<pre>first line\n  <b>second</b> line</pre>');
    expect(root.querySelector('.md-code code')?.textContent).toBe('first line\n  second line');
  });

  it('renders a 200 KB review', () => {
    const fold = [
      '<details><summary><b>NOTE:</b> Finding</summary>',
      '',
      'Some text with `code` and a [link](https://example.com).',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '</details>',
      '',
    ].join('\n');
    const text = fold.repeat(Math.ceil(200_000 / fold.length));
    expect(text.length).toBeGreaterThanOrEqual(200_000);
    const root = rendered(text);
    expect(root.querySelectorAll('details').length).toBe(Math.ceil(200_000 / fold.length));
  }, 30_000);
});
