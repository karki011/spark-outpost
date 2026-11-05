import { describe, expect, it } from 'vitest';
import { parseGuidePage } from './guide.ts';
import { guideChunks, searchGuidePages } from './guide-search.ts';

function page(slug: string, title: string, summary: string, body: string) {
  return parseGuidePage(
    slug,
    `---\ntitle: ${title}\nsection: Basics\ntype: how-to\norder: 1\nsummary: ${summary}\n---\n${body}`,
  );
}

const PAGES = [
  page(
    'chats',
    'Chats and modes',
    'Start a chat and pick how much Spark does alone.',
    `Open a chat from the rail.

## Agent modes

Pick **Accept edits** to let Claude edit files without asking.

## Spark autonomy

Full auto opens a pull request when checks pass.`,
  ),
  page(
    'jev',
    'Jev',
    'The advisor that routes work.',
    `## What Jev decides

Jev picks the model for each piece of work.

## What it costs

Jev answers cost a fraction of a cent.`,
  ),
  page(
    'approvals',
    'Approvals',
    'What Spark asks first.',
    `## Protected paths

Secret files like \`.env\` always ask.

\`\`\`text
.env
\`\`\``,
  ),
];

describe('guideChunks', () => {
  it('splits a page by heading into plain text without Markdown marks', () => {
    const chunks = guideChunks(PAGES[0]!);
    expect(chunks.map((chunk) => chunk.anchor)).toEqual([null, 'agent-modes', 'spark-autonomy']);
    expect(chunks[1]!.text).toBe('Pick Accept edits to let Claude edit files without asking.');
  });

  it('keeps code text but drops fence lines', () => {
    const [chunk] = guideChunks(PAGES[2]!);
    expect(chunk?.anchor).toBe('protected-paths');
    expect(chunk?.text).toBe('Secret files like .env always ask. .env');
  });
});

describe('searchGuidePages', () => {
  it('ranks a title match first and points at the best heading', () => {
    const hits = searchGuidePages(PAGES, 'jev cost');
    expect(hits[0]).toMatchObject({ slug: 'jev', anchor: 'what-it-costs' });
    expect(hits[0]!.snippet).toContain('cost');
  });

  it('finds words in headings and body text, with simple plurals', () => {
    expect(searchGuidePages(PAGES, 'protected path')[0]?.slug).toBe('approvals');
    expect(searchGuidePages(PAGES, 'pull requests')[0]).toMatchObject({
      slug: 'chats',
      anchor: 'spark-autonomy',
    });
  });

  it('matches prefixes as you type, but a short word never matches a longer query', () => {
    expect(searchGuidePages(PAGES, 'autono')[0]?.slug).toBe('chats');
    expect(searchGuidePages(PAGES, 'sparkignore')).toEqual([]);
  });

  it('returns nothing for an empty or unmatched query and respects the limit', () => {
    expect(searchGuidePages(PAGES, '')).toEqual([]);
    expect(searchGuidePages(PAGES, 'the of')).toEqual([]);
    expect(searchGuidePages(PAGES, 'zzzqqq')).toEqual([]);
    expect(searchGuidePages(PAGES, 'spark', 1)).toHaveLength(1);
  });

  it('says which type of page each hit is', () => {
    expect(searchGuidePages(PAGES, 'jev')[0]).toMatchObject({ slug: 'jev', type: 'how-to' });
  });

  it('falls back to the summary when only the title matches', () => {
    const [hit] = searchGuidePages(PAGES, 'approvals');
    expect(hit).toMatchObject({
      slug: 'approvals',
      heading: null,
      snippet: 'What Spark asks first.',
    });
  });
});
