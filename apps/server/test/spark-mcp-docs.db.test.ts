import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let tools: SparkToolsHarness;

beforeEach(async () => {
  t = await createTestDb();
  tools = await startSparkTools(t);
});

afterEach(async () => {
  await tools.close();
  await t.cleanup();
});

interface Listed {
  page: string;
  title: string;
  type: string;
  comingSoon?: boolean;
}

interface ListedSection {
  section: string;
  pages: Listed[];
}

describe('spark_docs', () => {
  it('lists every guide page by section, in order, with its type', async () => {
    const { sections } = (await tools.call('spark_docs')).json<{ sections: ListedSection[] }>();
    expect(sections[0]).toMatchObject({ section: 'Get started' });
    expect(sections[0]!.pages[0]).toMatchObject({ page: 'welcome', type: 'start' });
    expect(sections.map((entry) => entry.section)).toEqual(
      expect.arrayContaining(['Chats', 'Understand Spark', 'Reference', 'Help']),
    );
    const pages = sections.flatMap((entry) => entry.pages);
    expect(pages.length).toBeGreaterThan(40);
    expect(sections.length).toBeLessThanOrEqual(7);
    expect(pages.filter((page) => page.comingSoon)).toEqual([]);
    expect(pages.map((page) => page.page)).not.toContain('README');
    expect(JSON.stringify(sections)).not.toMatch(/… \d+ more/);
  });

  it('narrows the list and the search to one type of page', async () => {
    const { sections } = (await tools.call('spark_docs', { type: 'troubleshooting' })).json<{
      sections: ListedSection[];
    }>();
    expect(sections.map((entry) => entry.section)).toEqual(['Help']);
    expect(sections[0]!.pages.map((page) => page.page)).toContain('trouble-providers');

    const { matches } = (
      await tools.call('spark_docs', { query: 'agent mode', type: 'reference' })
    ).json<{ matches: { page: string; type: string }[] }>();
    expect(matches[0]).toMatchObject({ page: 'modes-and-levels', type: 'reference' });
    expect(matches.every((match) => match.type === 'reference')).toBe(true);
  });

  it('searches by task and answers with the matching section, its text and a Docs link', async () => {
    const result = await tools.call('spark_docs', { query: 'how do I hold to confirm a git hook' });
    const { matches } = result.json<{
      matches: { page: string; type: string; heading: string; link: string; text: string }[];
    }>();
    expect(matches[0]).toMatchObject({
      page: 'answer-approvals',
      type: 'how-to',
      heading: 'Hold to confirm',
      link: '#/docs/answer-approvals#hold-to-confirm',
    });
    expect(matches[0]!.text).toContain('Hold to allow once');
  });

  it.each([
    ['queue a message while the agent works', 'follow-a-turn'],
    ['delete a chat that is running', 'follow-a-turn'],
    ['provider will not connect', 'trouble-providers'],
    ['what changed since the last release', 'whats-new'],
    ['keep files away from agents', 'sparkignore'],
    ['open a pull request', 'ship-and-pull-requests'],
  ])('finds "%s" on %s', async (query, page) => {
    const { matches } = (await tools.call('spark_docs', { query, limit: 3 })).json<{
      matches: { page: string }[];
    }>();
    expect(matches.map((match) => match.page)).toContain(page);
  });

  it('reads a page split by heading, with screenshots as text', async () => {
    const page = (await tools.call('spark_docs', { page: 'spark-autonomy' })).json<{
      title: string;
      type: string;
      link: string;
      headings: { anchor: string }[];
      sections: { anchor: string | null; link: string; text: string }[];
    }>();
    expect(page.title).toBe('Choose how much Spark does alone');
    expect(page.type).toBe('how-to');
    expect(page.link).toBe('#/docs/spark-autonomy');
    expect(page.headings.map((heading) => heading.anchor)).toContain('for-one-chat');
    const oneChat = page.sections.find((section) => section.anchor === 'for-one-chat');
    expect(oneChat?.link).toBe('#/docs/spark-autonomy#for-one-chat');
    expect(oneChat?.text).toContain('Full auto → PR');
    expect(oneChat?.text).toContain('[Screenshot: The Work panel with the Spark autonomy levels]');
    expect(oneChat?.text).not.toContain('images/');
  });

  it('reads one heading and explains unknown pages and headings', async () => {
    const one = (
      await tools.call('spark_docs', { page: 'approvals', heading: 'if-you-dont-answer' })
    ).json<{ sections: { anchor: string; text: string }[] }>();
    expect(one.sections.map((section) => section.anchor)).toEqual(['if-you-dont-answer']);
    expect(one.sections[0]!.text).toContain('30 minutes');

    const missing = await tools.call('spark_docs', { page: 'queue-messages' });
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toContain('Known pages: welcome');
    const noHeading = await tools.call('spark_docs', { page: 'jev', heading: 'zzz' });
    expect(noHeading.text).toContain('Headings: what-jev-decides');
  });

  it('lists every page when a search finds nothing', async () => {
    const { matches, sections, note } = (await tools.call('spark_docs', { query: 'zzzqqq' })).json<{
      matches: unknown[];
      sections: ListedSection[];
      note: string;
    }>();
    expect(matches).toEqual([]);
    expect(sections.flatMap((entry) => entry.pages).length).toBeGreaterThan(40);
    expect(note).toContain('page');
  });
});
