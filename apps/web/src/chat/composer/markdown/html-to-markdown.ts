import { codeFence, codeSpan } from './backticks.ts';

const SKIPPED = new Set([
  'HEAD',
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'META',
  'LINK',
  'TITLE',
]);
const BLOCKS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'MAIN',
  'ASIDE',
  'NAV',
  'FIGURE',
  'FIGCAPTION',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'DL',
  'DT',
  'DD',
  'ADDRESS',
]);
const HEADINGS: Record<string, string> = {
  H1: '#',
  H2: '##',
  H3: '###',
  H4: '####',
  H5: '#####',
  H6: '######',
};
const CODE = new Set(['CODE', 'KBD', 'SAMP', 'TT']);
const SAFE_LINK = /^(https?:|mailto:)/i;
const BOLD_WEIGHT = /^(bold|bolder|[6-9]00)$/;

interface Style {
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

function inlineStyle(element: HTMLElement): Style {
  const style = element.style;
  const tag = element.tagName;
  const weight = style.fontWeight;
  const plainWeight = weight === 'normal' || weight === '400';
  return {
    bold: BOLD_WEIGHT.test(weight) || ((tag === 'B' || tag === 'STRONG') && !plainWeight),
    italic: style.fontStyle === 'italic' || tag === 'I' || tag === 'EM',
    strike:
      style.textDecoration.includes('line-through') ||
      style.textDecorationLine.includes('line-through') ||
      tag === 'S' ||
      tag === 'DEL' ||
      tag === 'STRIKE',
  };
}

function wrap(text: string, marker: string): string {
  const core = text.trim();
  if (core === '') return text;
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
  return `${lead}${marker}${core}${marker}${trail}`;
}

function inlineCode(text: string): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.trim() === '' ? flat : codeSpan(flat);
}

class Converter {
  private inline(node: Node, pre: boolean): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      return pre ? text : text.replace(/\s+/g, ' ');
    }
    if (!(node instanceof HTMLElement)) return '';
    return this.element(node, pre);
  }

  private children(element: Element, pre: boolean): string {
    return Array.from(element.childNodes, (child) => this.inline(child, pre)).join('');
  }

  private list(element: HTMLElement, ordered: boolean): string {
    const items = Array.from(element.children).filter((child) => child.tagName === 'LI');
    const lines = items.map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : '- ';
      const body = this.children(item, false).trim().replace(/\n+/g, '\n  ');
      return `${marker}${body}`;
    });
    return `\n\n${lines.join('\n')}\n\n`;
  }

  private element(element: HTMLElement, pre: boolean): string {
    const tag = element.tagName;
    if (SKIPPED.has(tag)) return '';
    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'IMG') return element.getAttribute('alt') ?? '';
    if (tag === 'PRE')
      return `\n\n${codeFence((element.textContent ?? '').replace(/\n$/, ''))}\n\n`;
    if (CODE.has(tag) && !pre) return inlineCode(element.textContent ?? '');
    if (tag === 'UL' || tag === 'OL') return this.list(element, tag === 'OL');
    const heading = HEADINGS[tag];
    if (heading) return `\n\n${heading} ${this.children(element, pre).trim()}\n\n`;
    if (tag === 'BLOCKQUOTE') {
      const body = this.children(element, pre).trim();
      return `\n\n${body
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')}\n\n`;
    }
    if (tag === 'TD' || tag === 'TH') return `${this.children(element, pre).trim()} `;
    let text = this.children(element, pre);
    if (tag === 'A') {
      const href = element.getAttribute('href') ?? '';
      if (SAFE_LINK.test(href) && text.trim() !== '') text = `[${text.trim()}](${href})`;
    }
    const style = inlineStyle(element);
    if (style.strike) text = wrap(text, '~~');
    if (style.italic) text = wrap(text, '_');
    if (style.bold) text = wrap(text, '**');
    return BLOCKS.has(tag) ? `\n\n${text.trim()}\n\n` : text;
  }

  convert(body: HTMLElement): string {
    return this.children(body, false)
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

export function htmlToMarkdown(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return new Converter().convert(parsed.body);
}
