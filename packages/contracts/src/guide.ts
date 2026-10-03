import { z } from 'zod';

export interface GuideHeading {
  depth: number;
  text: string;
  anchor: string;
}

export const GUIDE_PAGE_TYPES = [
  'start',
  'how-to',
  'concept',
  'reference',
  'troubleshooting',
  'whats-new',
] as const;

export type GuidePageType = (typeof GUIDE_PAGE_TYPES)[number];

export const GUIDE_TYPE_LABELS: Readonly<Record<GuidePageType, string>> = {
  start: 'Get started',
  'how-to': 'How-to',
  concept: 'Concept',
  reference: 'Reference',
  troubleshooting: 'Troubleshooting',
  'whats-new': "What's new",
};

export interface GuidePage {
  slug: string;
  title: string;
  section: string;
  type: GuidePageType;
  order: number;
  summary: string;
  body: string;
  headings: GuideHeading[];
  comingSoon: boolean;
}

export interface GuideNavSection {
  section: string;
  pages: GuidePage[];
}

export interface GuideLink {
  slug: string;
  anchor: string | null;
}

const frontmatterSchema = z.object({
  title: z.string().min(1),
  section: z.string().min(1),
  type: z.enum(GUIDE_PAGE_TYPES),
  order: z.coerce.number().int(),
  summary: z.string().min(1),
});

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FENCE = /^\s*(```|~~~)/;
export const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const COMING_SOON = /^>\s*\*\*Coming soon/m;
const LINK_PREFIX = '#/docs';

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2]! : trimmed;
}

function parseFrontmatter(slug: string, block: string) {
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^([a-zA-Z]+):\s*(.*)$/.exec(line);
    if (match) fields[match[1]!] = unquote(match[2]!);
  }
  const parsed = frontmatterSchema.safeParse(fields);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Guide page ${slug} has bad frontmatter: ${missing}`);
  }
  return parsed.data;
}

export function inlineText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .trim();
}

export function headingAnchor(text: string): string {
  return inlineText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

export function uniqueAnchors(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = headingAnchor(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

export function markdownLines(body: string): { line: string; code: boolean }[] {
  let fenced = false;
  return body.split(/\r?\n/).map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return { line, code: true };
    }
    return { line, code: fenced };
  });
}

function extractHeadings(body: string): GuideHeading[] {
  const found: { depth: number; text: string }[] = [];
  for (const { line, code } of markdownLines(body)) {
    if (code) continue;
    const match = HEADING_LINE.exec(line);
    if (match) found.push({ depth: match[1]!.length, text: inlineText(match[2]!) });
  }
  const anchors = uniqueAnchors(found.map((heading) => heading.text));
  return found.map((heading, index) => ({ ...heading, anchor: anchors[index]! }));
}

export function parseGuidePage(slug: string, source: string): GuidePage {
  const match = FRONTMATTER.exec(source);
  if (!match) throw new Error(`Guide page ${slug} has no frontmatter.`);
  const meta = parseFrontmatter(slug, match[1]!);
  const body = source.slice(match[0].length).replace(/^\s+/, '');
  return {
    slug,
    ...meta,
    body,
    headings: extractHeadings(body),
    comingSoon: COMING_SOON.test(body),
  };
}

export function guideSlug(fileName: string): string | null {
  const base = fileName.split('/').pop() ?? '';
  if (!base.endsWith('.md') || base.toLowerCase() === 'readme.md') return null;
  return base.slice(0, -3);
}

export function loadGuidePages(files: Record<string, string>): GuidePage[] {
  const pages: GuidePage[] = [];
  for (const [file, source] of Object.entries(files)) {
    const slug = guideSlug(file);
    if (slug) pages.push(parseGuidePage(slug, source));
  }
  return pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function groupGuideSections(pages: readonly GuidePage[]): GuideNavSection[] {
  const sections: GuideNavSection[] = [];
  const sorted = [...pages].sort((a, b) => a.order - b.order);
  for (const page of sorted) {
    const existing = sections.find((entry) => entry.section === page.section);
    if (existing) existing.pages.push(page);
    else sections.push({ section: page.section, pages: [page] });
  }
  return sections;
}

export function guideLink(slug: string, anchor?: string | null): string {
  return `${LINK_PREFIX}/${slug}${anchor ? `#${anchor}` : ''}`;
}

export function parseGuideLink(hash: string): GuideLink | null {
  if (hash !== LINK_PREFIX && !hash.startsWith(`${LINK_PREFIX}/`)) return null;
  const rest = hash.slice(LINK_PREFIX.length + 1);
  const [slugPart = '', anchorPart] = rest.split('#', 2);
  const slug = decodeURIComponent(slugPart).replace(/\/$/, '');
  const anchor = anchorPart ? decodeURIComponent(anchorPart) : null;
  return { slug, anchor };
}

const NEXT_LINK = /\n*\*\*Next:\*\* \[[^\]]+\]\(([^)\s]+)\)\s*$/;

export function guideNextSlug(page: GuidePage): string | null {
  const match = NEXT_LINK.exec(page.body);
  return match ? (guideHrefTarget(match[1]!)?.slug ?? null) : null;
}

export function guideBodyWithoutNext(page: GuidePage): string {
  return page.body.replace(NEXT_LINK, '\n');
}

export function resolveGuideLink(
  pages: readonly GuidePage[],
  redirects: Readonly<Record<string, string>>,
  link: GuideLink,
): GuideLink | null {
  const page = pages.find((entry) => entry.slug === link.slug);
  const anchorExists =
    link.anchor === null || page?.headings.some((heading) => heading.anchor === link.anchor);
  if (page && anchorExists) return link;
  const moved =
    (link.anchor ? redirects[`${link.slug}#${link.anchor}`] : undefined) ??
    (page ? undefined : redirects[link.slug]);
  if (moved) {
    const [slug = '', anchor] = moved.split('#', 2);
    return { slug, anchor: anchor ?? null };
  }
  return page ? { slug: link.slug, anchor: null } : null;
}

export function guideHrefTarget(href: string): GuideLink | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  if (href.startsWith('#/docs')) return parseGuideLink(href);
  if (href.startsWith('#')) return { slug: '', anchor: decodeURIComponent(href.slice(1)) };
  const [rawPath = '', anchor] = href.split('#', 2);
  const path = rawPath.replace(/^\.\//, '');
  const slug = guideSlug(path);
  if (!slug || path.includes('/')) return null;
  return { slug, anchor: anchor ? decodeURIComponent(anchor) : null };
}
