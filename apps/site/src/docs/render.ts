import { guideHrefTarget, uniqueAnchors } from '@spark-outpost/contracts';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { docHref, IMAGE_BASE } from './urls.ts';

export interface GuideImage {
  light: string;
  dark: string | null;
  width: number;
  height: number;
}

export interface RenderContext {
  slug: string;
  slugs: ReadonlySet<string>;
  image: (src: string) => GuideImage | null;
}

export interface RenderedBody {
  html: string;
  images: string[];
  problems: string[];
}

const WEB_LINK = /^(https?:|mailto:)/i;
const HEADING = /^h[1-6]$/;
const CALLOUTS = new Set(['tip', 'note', 'important']);

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

function element(
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[] = [],
): Element {
  return { type: 'element', tagName, properties, children };
}

function textOf(node: RootContent | ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

function elementsIn(node: Root | Element, found: Element[] = []): Element[] {
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    found.push(child);
    elementsIn(child, found);
  }
  return found;
}

function calloutKind(quote: Element): string | null {
  const paragraph = quote.children.find((child) => child.type === 'element');
  const lead = paragraph?.type === 'element' ? paragraph.children[0] : undefined;
  if (lead?.type !== 'element' || lead.tagName !== 'strong') return null;
  const kind = textOf(lead)
    .replace(/[:.]\s*$/, '')
    .toLowerCase();
  return CALLOUTS.has(kind) ? kind : null;
}

function linkHeadings(headings: Element[]): void {
  const anchors = uniqueAnchors(headings.map(textOf));
  headings.forEach((heading, index) => {
    const id = anchors[index]!;
    heading.properties = { ...heading.properties, id };
    heading.children = [element('a', { href: `#${id}` }, heading.children)];
  });
}

function rewriteLink(link: Element, context: RenderContext, problems: string[]): void {
  const href = String(link.properties.href ?? '');
  if (WEB_LINK.test(href)) return;
  const target = guideHrefTarget(href);
  const slug = target ? target.slug || context.slug : null;
  if (!target || !slug || !context.slugs.has(slug)) {
    problems.push(`${context.slug}.md links to a missing page: ${href}`);
    return;
  }
  link.properties.href =
    slug === context.slug && target.anchor ? `#${target.anchor}` : docHref(slug, target.anchor);
}

function pictureFor(image: GuideImage, alt: string): Element {
  const img = element('img', {
    src: `${IMAGE_BASE}${image.light}`,
    alt,
    width: image.width,
    height: image.height,
    loading: 'lazy',
    decoding: 'async',
  });
  if (!image.dark) return element('picture', { className: ['doc-shot'] }, [img]);
  const dark = element('source', {
    srcSet: `${IMAGE_BASE}${image.dark}`,
    media: '(prefers-color-scheme: dark)',
  });
  return element('picture', { className: ['doc-shot'] }, [dark, img]);
}

function replaceImage(img: Element, context: RenderContext, used: Set<string>, problems: string[]) {
  const src = String(img.properties.src ?? '');
  const image = context.image(src);
  if (!image) {
    problems.push(`${context.slug}.md shows a missing or non-PNG image: ${src}`);
    return;
  }
  used.add(image.light);
  if (image.dark) used.add(image.dark);
  Object.assign(img, pictureFor(image, String(img.properties.alt ?? '')));
}

function wrapTable(table: Element): void {
  const inner = element('table', table.properties, table.children);
  Object.assign(
    table,
    element(
      'div',
      { className: ['table-scroll'], tabIndex: 0, role: 'region', ariaLabel: 'Table' },
      [inner],
    ),
  );
}

export function renderGuideBody(markdown: string, context: RenderContext): RenderedBody {
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  const nodes = elementsIn(tree);
  const problems: string[] = [];
  const used = new Set<string>();
  linkHeadings(nodes.filter((node) => HEADING.test(node.tagName)));
  for (const node of nodes) {
    if (node.tagName === 'a') rewriteLink(node, context, problems);
    else if (node.tagName === 'img') replaceImage(node, context, used, problems);
    else if (node.tagName === 'table') wrapTable(node);
    else if (node.tagName === 'blockquote') {
      const kind = calloutKind(node);
      if (kind) node.properties.className = ['doc-callout', `doc-callout-${kind}`];
    }
  }
  return { html: toHtml(tree), images: [...used], problems };
}
