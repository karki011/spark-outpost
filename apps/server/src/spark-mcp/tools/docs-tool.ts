import { z } from 'zod';
import {
  GUIDE_PAGE_TYPES,
  GUIDE_REDIRECTS,
  groupGuideSections,
  guideChunks,
  guideLink,
  HEADING_LINE,
  headingAnchor,
  markdownLines,
  resolveGuideLink,
  searchGuidePages,
  type GuidePage,
  type GuidePageType,
} from '@spark-outpost/contracts';
import { guidePages } from '../docs/guide-files.ts';
import { limitInput, sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;

export function guideListing(pages: readonly GuidePage[]) {
  return groupGuideSections(pages).map((group) => ({
    section: group.section,
    pages: group.pages.map((page) => ({
      page: page.slug,
      title: page.title,
      type: page.type,
      summary: page.summary,
      ...(page.comingSoon ? { comingSoon: true } : {}),
    })),
  }));
}

interface Target {
  page: GuidePage;
  anchor: string | null;
  movedFrom: string | null;
}

function findTarget(
  pages: readonly GuidePage[],
  slug: string,
  heading: string | undefined,
): Target {
  const anchor = heading ? headingAnchor(heading) : null;
  const resolved = resolveGuideLink(pages, GUIDE_REDIRECTS, { slug, anchor });
  const page = resolved ? pages.find((entry) => entry.slug === resolved.slug) : undefined;
  if (!resolved || !page) {
    const known = pages.map((entry) => entry.slug).join(', ');
    throw new SparkToolError(`No guide page "${slug}". Known pages: ${known}`);
  }
  const moved = page.slug !== slug;
  if (!moved && anchor && resolved.anchor !== anchor) {
    const known = page.headings.map((entry) => entry.anchor).join(', ');
    throw new SparkToolError(`No heading "${heading}" on ${page.slug}. Headings: ${known}`);
  }
  return { page, anchor: resolved.anchor, movedFrom: moved ? slug : null };
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

export function readGuidePage({ page, anchor, movedFrom }: Target) {
  const sections = pageSections(page);
  return {
    page: page.slug,
    title: page.title,
    section: page.section,
    type: page.type,
    summary: page.summary,
    link: guideLink(page.slug),
    ...(movedFrom ? { movedFrom } : {}),
    ...(page.comingSoon ? { comingSoon: true } : {}),
    headings: page.headings.map((entry) => ({ text: entry.text, anchor: entry.anchor })),
    sections: anchor ? sections.filter((section) => section.anchor === anchor) : sections,
  };
}

async function docs(args: {
  page?: string | undefined;
  heading?: string | undefined;
  query?: string | undefined;
  type?: GuidePageType | undefined;
  limit: number;
}) {
  const all = await guidePages();
  if (args.page) return readGuidePage(findTarget(all, args.page, args.heading));
  const pages = args.type ? all.filter((page) => page.type === args.type) : all;
  if (!args.query) return { sections: guideListing(pages) };
  const hits = searchGuidePages(pages, args.query, args.limit);
  if (hits.length === 0) {
    return {
      matches: [],
      sections: guideListing(pages),
      note: 'No guide page matched. Here is every page; read one with `page`.',
    };
  }
  return {
    matches: hits.map((hit) => {
      const page = all.find((entry) => entry.slug === hit.slug)!;
      const chunk = guideChunks(page).find((entry) => entry.anchor === hit.anchor);
      return {
        page: hit.slug,
        title: hit.title,
        type: hit.type,
        heading: hit.heading,
        link: guideLink(hit.slug, hit.anchor),
        snippet: hit.snippet,
        text: (hit.anchor ? chunk?.text : null) ?? page.summary,
      };
    }),
  };
}

export const docsTool = sparkTool({
  name: 'spark_docs',
  title: 'Spark user guide',
  description:
    'The Spark Outpost user guide, the same pages the user sees under Docs in the app, one job per page, with the real button and setting names. Each page has a `type`: how-to (steps for one task), start (setup), concept (how it works), reference (tables: settings, modes, cards, protected paths, tools, shortcuts, statuses, glossary), troubleshooting (you see, why, fix) or whats-new. No arguments lists every page by section; `query` searches by task and returns the best section of each page; `type` narrows the list or the search; `page` (a page id from the list; ids of moved pages still work) reads one page, optionally only the section under `heading` (an anchor or heading text). Give the user the `link` (#/docs/…) so they can open the page in Docs.',
  input: {
    query: z.string().max(300).optional(),
    page: z.string().max(80).optional(),
    heading: z.string().max(120).optional(),
    type: z.enum(GUIDE_PAGE_TYPES).optional(),
    limit: limitInput(3, 8),
  },
  run: (args, _context: SparkToolContext) => docs(args),
});
