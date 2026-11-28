import {
  GUIDE_SECTIONS,
  guideHrefTarget,
  guideLineWords,
  guideNavLabel,
  guideNextSlug,
  markdownLines,
  type GuidePage,
  type GuidePageType,
} from '../packages/contracts/src/guide.ts';
import { WHATS_NEW_WORDS_MAX } from '../packages/contracts/src/guide-whats-new.ts';

export const WORD_CAPS: Readonly<Record<GuidePageType, number>> = {
  start: 200,
  'how-to': 300,
  concept: 300,
  reference: 600,
  troubleshooting: 350,
  'whats-new': WHATS_NEW_WORDS_MAX,
};

export const PARAGRAPH_WORDS_MAX = 40;
export const SUMMARY_CHARS_MAX = 170;
export const TITLE_CHARS_MAX = 40;
export const NAV_CHARS_MAX = 26;
export const HEADING_CHARS_MAX = 40;
export const TABLE_COLUMNS_MAX = 4;
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

export function proseWords(body: string): number {
  return markdownLines(body)
    .filter(({ line }) => !TABLE_RULE.test(line))
    .reduce((sum, { line }) => sum + guideLineWords(line), 0);
}

export function longestParagraph(body: string): number {
  let longest = 0;
  let current = 0;
  for (const { line, code } of markdownLines(body)) {
    const prose = !code && line.trim() !== '' && !BLOCK_START.test(line) && !/^\s{2,}/.test(line);
    current = prose ? current + guideLineWords(line) : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function tableCells(row: string): number {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/).length;
}

function tableBlocks(body: string): string[][] {
  const tables: string[][] = [];
  let current: string[] = [];
  for (const { line, code } of markdownLines(body)) {
    if (!code && line.trim().startsWith('|')) {
      current.push(line);
      continue;
    }
    if (current.length > 0) tables.push(current);
    current = [];
  }
  if (current.length > 0) tables.push(current);
  return tables;
}

export function tableProblems(body: string): string[] {
  const problems: string[] = [];
  for (const rows of tableBlocks(body)) {
    if (!TABLE_RULE.test(rows[1] ?? '')) {
      problems.push(`a table starts without a header row: ${rows[0]!.trim().slice(0, 40)}`);
      continue;
    }
    const columns = tableCells(rows[0]!);
    if (columns > TABLE_COLUMNS_MAX) {
      problems.push(
        `a table has ${columns} columns; keep tables to ${TABLE_COLUMNS_MAX}: ${rows[0]!.trim().slice(0, 40)}`,
      );
    }
    for (const row of rows.slice(2)) {
      const cells = tableCells(row);
      if (cells !== columns) {
        problems.push(
          `a table row has ${cells} cells; its header has ${columns}: ${row.trim().slice(0, 40)}`,
        );
      }
    }
  }
  return problems;
}

function pageNaming(page: GuidePage): string[] {
  const problems: string[] = [];
  if (!(GUIDE_SECTIONS as readonly string[]).includes(page.section)) {
    problems.push(`unknown section "${page.section}"; sections are ${GUIDE_SECTIONS.join(', ')}`);
  }
  if (page.title.length > TITLE_CHARS_MAX) {
    problems.push(`title is ${page.title.length} characters; keep it to ${TITLE_CHARS_MAX}`);
  }
  if (page.nav === null && page.title.length > NAV_CHARS_MAX) {
    problems.push(
      `title is ${page.title.length} characters; add a nav label of up to ${NAV_CHARS_MAX} for the sidebar`,
    );
  }
  if (page.nav !== null && page.nav.length > NAV_CHARS_MAX) {
    problems.push(`nav label is ${page.nav.length} characters; keep it to ${NAV_CHARS_MAX}`);
  }
  if (page.nav === page.title) problems.push('nav label repeats the title; leave it out');
  for (const heading of page.headings) {
    if (heading.depth === 2 && heading.text.length > HEADING_CHARS_MAX) {
      problems.push(
        `heading "${heading.text}" is ${heading.text.length} characters; keep ## headings to ${HEADING_CHARS_MAX}`,
      );
    }
  }
  return problems;
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
  problems.push(...tableProblems(page.body));
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

export function guideWords(pages: readonly GuidePage[]): number {
  return pages.reduce((sum, page) => sum + proseWords(page.body), 0);
}

export function checkPages(pages: readonly GuidePage[]): GuideViolation[] {
  const violations: GuideViolation[] = [];
  const titles = new Map<string, string>();
  const labels = new Map<string, string>();
  const orders = new Map<string, string>();
  for (const page of pages) {
    const twin = titles.get(page.title);
    if (twin) violations.push({ page: page.slug, message: `same title as ${twin}` });
    titles.set(page.title, page.slug);
    const label = guideNavLabel(page);
    const sameLabel = labels.get(label);
    if (sameLabel && !twin) {
      violations.push({ page: page.slug, message: `same sidebar label as ${sameLabel}` });
    }
    labels.set(label, page.slug);
    const slot = `${page.section}\n${page.order}`;
    const sameOrder = orders.get(slot);
    if (sameOrder) {
      violations.push({
        page: page.slug,
        message: `same order ${page.order} as ${sameOrder} in ${page.section}`,
      });
    }
    orders.set(slot, page.slug);
    for (const message of [...pageNaming(page), ...pageShape(page), ...pageLinks(page, pages)]) {
      violations.push({ page: page.slug, message });
    }
  }
  return violations;
}
