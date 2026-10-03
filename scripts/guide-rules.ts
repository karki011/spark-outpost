import {
  guideHrefTarget,
  guideNextSlug,
  inlineText,
  markdownLines,
  resolveGuideLink,
  type GuidePage,
  type GuidePageType,
} from '../packages/contracts/src/guide.ts';

export const WORD_CAPS: Readonly<Record<GuidePageType, number>> = {
  start: 300,
  'how-to': 450,
  concept: 400,
  reference: 800,
  troubleshooting: 450,
  'whats-new': 600,
};

export const PARAGRAPH_WORDS_MAX = 60;
export const SUMMARY_CHARS_MAX = 170;
const SEQUENCE_TYPES: readonly GuidePageType[] = ['start', 'how-to'];

export interface GuideViolation {
  page: string;
  message: string;
}

const TABLE_RULE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const BLOCK_START = /^\s*(#{1,6}\s|>|\||[-*+]\s|\d+\.\s)/;
const LINK = /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g;
const IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const TIP = /^>\s*\*\*Tip:\*\*/gm;
const TIME_ESTIMATE = /About \d+ minutes?\./;
const NUMBERED_STEP = /^\s*1\.\s/m;

function wordsIn(line: string): number {
  const text = inlineText(line.replace(IMAGE, ' ').replace(/\|/g, ' ')).replace(
    /^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/,
    '',
  );
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function proseWords(body: string): number {
  return markdownLines(body)
    .filter(({ line }) => !TABLE_RULE.test(line))
    .reduce((sum, { line }) => sum + wordsIn(line), 0);
}

export function longestParagraph(body: string): number {
  let longest = 0;
  let current = 0;
  for (const { line, code } of markdownLines(body)) {
    const prose = !code && line.trim() !== '' && !BLOCK_START.test(line) && !/^\s{2,}/.test(line);
    current = prose ? current + wordsIn(line) : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function pageShape(page: GuidePage): string[] {
  const problems: string[] = [];
  const words = proseWords(page.body);
  const cap = WORD_CAPS[page.type];
  if (words > cap) problems.push(`${words} words; a ${page.type} page may have ${cap}`);
  const paragraph = longestParagraph(page.body);
  if (paragraph > PARAGRAPH_WORDS_MAX) {
    problems.push(`a ${paragraph}-word paragraph; keep paragraphs to ${PARAGRAPH_WORDS_MAX}`);
  }
  if (page.summary.length > SUMMARY_CHARS_MAX) {
    problems.push(`summary is ${page.summary.length} characters; keep it to ${SUMMARY_CHARS_MAX}`);
  }
  if (page.headings.some((heading) => heading.depth === 1)) {
    problems.push('has a # heading; the title comes from the frontmatter');
  }
  if ((page.body.match(TIP) ?? []).length > 1) problems.push('more than one Tip');
  if (page.type === 'how-to') {
    if (!TIME_ESTIMATE.test(page.body.split('\n\n')[0] ?? '')) {
      problems.push('a how-to opens with its outcome and "About N minutes."');
    }
    if (!NUMBERED_STEP.test(page.body)) problems.push('a how-to needs numbered steps');
  }
  return problems;
}

function targetExists(pages: readonly GuidePage[], slug: string, anchor: string | null): boolean {
  const page = pages.find((entry) => entry.slug === slug);
  if (!page) return false;
  return anchor === null || page.headings.some((heading) => heading.anchor === anchor);
}

function pageLinks(page: GuidePage, pages: readonly GuidePage[]): string[] {
  const problems: string[] = [];
  for (const match of page.body.matchAll(LINK)) {
    const target = guideHrefTarget(match[1]!);
    if (target && !targetExists(pages, target.slug || page.slug, target.anchor)) {
      problems.push(`broken link ${match[1]}`);
    }
  }
  const next = guideNextSlug(page);
  if (SEQUENCE_TYPES.includes(page.type) && !next) {
    problems.push('ends without a **Next:** link');
  }
  if (next) {
    const target = pages.find((entry) => entry.slug === next);
    const label = /\*\*Next:\*\* \[([^\]]+)\]/.exec(page.body)?.[1];
    if (target && label !== target.title) {
      problems.push(`Next link says "${label}" but the page is titled "${target.title}"`);
    }
  }
  return problems;
}

export function imagesShown(pages: readonly GuidePage[]): { page: string; file: string }[] {
  return pages.flatMap((page) =>
    [...page.body.matchAll(IMAGE)].map((match) => ({ page: page.slug, file: match[1]! })),
  );
}

export function checkImages(
  pages: readonly GuidePage[],
  imageFiles: readonly string[],
): GuideViolation[] {
  const files = new Set(imageFiles);
  const shown = imagesShown(pages);
  const violations: GuideViolation[] = [];
  for (const { page, file } of shown) {
    const name = file.replace(/^images\//, '');
    for (const wanted of [name, name.replace(/-light\.png$/, '-dark.png')]) {
      if (!files.has(wanted)) violations.push({ page, message: `missing image ${wanted}` });
    }
  }
  const used = new Set(
    shown.map(({ file }) => file.replace(/^images\//, '').replace(/-light\.png$/, '')),
  );
  for (const file of imageFiles) {
    if (!used.has(file.replace(/-(light|dark)\.png$/, ''))) {
      violations.push({ page: 'images', message: `${file} is not shown on any page` });
    }
  }
  return violations;
}

export function checkRedirects(
  pages: readonly GuidePage[],
  redirects: Readonly<Record<string, string>>,
): GuideViolation[] {
  const violations: GuideViolation[] = [];
  for (const [from, to] of Object.entries(redirects)) {
    const [fromSlug = '', fromAnchor] = from.split('#', 2);
    const [toSlug = '', toAnchor] = to.split('#', 2);
    if (!targetExists(pages, toSlug, toAnchor ?? null)) {
      violations.push({ page: 'redirects', message: `${from} points at missing ${to}` });
    }
    if (targetExists(pages, fromSlug, fromAnchor ?? null)) {
      violations.push({ page: 'redirects', message: `${from} still exists; drop the redirect` });
    }
    const resolved = resolveGuideLink(pages, redirects, {
      slug: fromSlug,
      anchor: fromAnchor ?? null,
    });
    if (!resolved) violations.push({ page: 'redirects', message: `${from} does not resolve` });
  }
  return violations;
}

export function checkCoverage(
  page: GuidePage | undefined,
  slug: string,
  kind: string,
  names: readonly string[],
): GuideViolation[] {
  if (!page) return [{ page: slug, message: 'reference page is missing' }];
  return names
    .filter((name) => !page.body.includes(name))
    .map((name) => ({ page: slug, message: `no entry for the ${kind} ${name}` }));
}

export function checkPages(pages: readonly GuidePage[]): GuideViolation[] {
  const violations: GuideViolation[] = [];
  const titles = new Map<string, string>();
  for (const page of pages) {
    const twin = titles.get(page.title);
    if (twin) violations.push({ page: page.slug, message: `same title as ${twin}` });
    titles.set(page.title, page.slug);
    for (const message of [...pageShape(page), ...pageLinks(page, pages)]) {
      violations.push({ page: page.slug, message });
    }
  }
  return violations;
}
