import { z } from 'zod';
import {
  guideChunks,
  guideLink,
  HEADING_LINE,
  headingAnchor,
  markdownLines,
  searchGuidePages,
  type GuidePage,
} from '@spark-outpost/contracts';
import { guidePages } from '../docs/guide-files.ts';
import { limitInput, sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;

function listing(pages: readonly GuidePage[]) {
  return pages.map((page) => ({
    page: page.slug,
    title: page.title,
    section: page.section,
    summary: page.summary,
    ...(page.comingSoon ? { comingSoon: true } : {}),
  }));
}

function findPage(pages: readonly GuidePage[], slug: string): GuidePage {
  const found = pages.find((page) => page.slug === slug);
  if (!found) {
    const known = pages.map((page) => page.slug).join(', ');
    throw new SparkToolError(`No guide page "${slug}". Known pages: ${known}`);
  }
  return found;
}

interface PageSection {
  anchor: string | null;
  link: string;
  text: string;
}

function pageSections(page: GuidePage): PageSection[] {
  const sections: PageSection[] = [{ anchor: null, link: guideLink(page.slug), text: '' }];
  let index = 0;
  for (const { line, code } of markdownLines(page.body)) {
    const heading = code || !HEADING_LINE.test(line) ? null : page.headings[index];
    if (heading) {
      index += 1;
      sections.push({
        anchor: heading.anchor,
        link: guideLink(page.slug, heading.anchor),
        text: '',
      });
    }
    const current = sections[sections.length - 1]!;
    current.text += `${line.replace(IMAGE, (_match, alt: string) => `[Screenshot: ${alt}]`)}\n`;
  }
  return sections
    .map((section) => ({ ...section, text: section.text.trim() }))
    .filter((section) => section.text);
}

function readPage(page: GuidePage, heading: string | undefined) {
  const sections = pageSections(page);
  const wanted = heading ? headingAnchor(heading) : null;
  const chosen = wanted ? sections.filter((section) => section.anchor === wanted) : sections;
  if (wanted && chosen.length === 0) {
    const known = page.headings.map((entry) => entry.anchor).join(', ');
    throw new SparkToolError(`No heading "${heading}" on ${page.slug}. Headings: ${known}`);
  }
  return {
    page: page.slug,
    title: page.title,
    section: page.section,
    summary: page.summary,
    link: guideLink(page.slug),
    ...(page.comingSoon ? { comingSoon: true } : {}),
    headings: page.headings.map((entry) => ({ text: entry.text, anchor: entry.anchor })),
    sections: chosen,
  };
}

async function docs(args: {
  page?: string | undefined;
  heading?: string | undefined;
  query?: string | undefined;
  limit: number;
}) {
  const pages = await guidePages();
  if (args.page) return readPage(findPage(pages, args.page), args.heading);
  if (!args.query) return { pages: listing(pages) };
  const hits = searchGuidePages(pages, args.query, args.limit);
  if (hits.length === 0) {
    return {
      matches: [],
      pages: listing(pages),
      note: 'No guide page matched. Here is every page; read one with `page`.',
    };
  }
  return {
    matches: hits.map((hit) => ({
      page: hit.slug,
      title: hit.title,
      heading: hit.heading,
      link: guideLink(hit.slug, hit.anchor),
      snippet: hit.snippet,
      text: hit.anchor
        ? (guideChunks(findPage(pages, hit.slug)).find((chunk) => chunk.anchor === hit.anchor)
            ?.text ?? '')
        : findPage(pages, hit.slug).summary,
    })),
  };
}

export const docsTool = sparkTool({
  name: 'spark_docs',
  title: 'Spark user guide',
  description:
    'The Spark Outpost user guide, the same pages the user sees under Docs in the app: step-by-step how-tos with the real button and setting names. No arguments lists every page; `query` searches titles, headings and text and returns the best section of each page; `page` (a page id from the list) reads one page, optionally only the section under `heading` (an anchor or heading text). Give the user the `link` (#/docs/…) so they can open the page in Docs. Pages marked comingSoon are only outlines.',
  input: {
    query: z.string().max(300).optional(),
    page: z.string().max(80).optional(),
    heading: z.string().max(120).optional(),
    limit: limitInput(3, 8),
  },
  run: (args, _context: SparkToolContext) => docs(args),
});
