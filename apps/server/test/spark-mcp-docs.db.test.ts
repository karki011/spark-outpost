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
  section: string;
  comingSoon?: boolean;
}

describe('spark_docs', () => {
  it('lists every guide page in order with its section and whether it is written', async () => {
    const { pages } = (await tools.call('spark_docs')).json<{ pages: Listed[] }>();
    expect(pages[0]).toMatchObject({ page: 'getting-started', section: 'Get started' });
    expect(pages.find((page) => page.page === 'approvals')).not.toHaveProperty('comingSoon');
    expect(pages.find((page) => page.page === 'guardrails')).toMatchObject({ comingSoon: true });
    expect(pages.map((page) => page.page)).not.toContain('README');
  });

  it('searches and answers with the matching section, its text and a Docs link', async () => {
    const result = await tools.call('spark_docs', { query: 'how do I hold to confirm a git hook' });
    const { matches } = result.json<{
      matches: { page: string; heading: string; link: string; text: string }[];
    }>();
    expect(matches[0]).toMatchObject({
      page: 'approvals',
      heading: 'Hold to confirm',
      link: '#/docs/approvals#hold-to-confirm',
    });
    expect(matches[0]!.text).toContain('Hold to allow once');
  });

  it('reads a page split by heading, with screenshots as text', async () => {
    const page = (await tools.call('spark_docs', { page: 'chats-and-modes' })).json<{
      title: string;
      link: string;
      headings: { anchor: string }[];
      sections: { anchor: string | null; link: string; text: string }[];
    }>();
    expect(page.title).toBe('Chats, modes and autonomy');
    expect(page.link).toBe('#/docs/chats-and-modes');
    expect(page.headings.map((heading) => heading.anchor)).toContain('spark-autonomy');
    const autonomy = page.sections.find((section) => section.anchor === 'spark-autonomy');
    expect(autonomy?.link).toBe('#/docs/chats-and-modes#spark-autonomy');
    expect(autonomy?.text).toContain('Full auto → PR');
    expect(autonomy?.text).toContain('[Screenshot: The Work panel with the Spark autonomy levels]');
    expect(autonomy?.text).not.toContain('images/');
  });

  it('reads one heading and explains unknown pages and headings', async () => {
    const one = (
      await tools.call('spark_docs', { page: 'approvals', heading: 'if-you-dont-answer' })
    ).json<{ sections: { anchor: string; text: string }[] }>();
    expect(one.sections.map((section) => section.anchor)).toEqual(['if-you-dont-answer']);
    expect(one.sections[0]!.text).toContain('30 minutes');

    const missing = await tools.call('spark_docs', { page: 'nope' });
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toContain('Known pages: getting-started');
    const noHeading = await tools.call('spark_docs', { page: 'jev', heading: 'zzz' });
    expect(noHeading.text).toContain('Headings: what-jev-decides');
  });

  it('lists every page when a search finds nothing', async () => {
    const { matches, pages, note } = (await tools.call('spark_docs', { query: 'zzzqqq' })).json<{
      matches: unknown[];
      pages: unknown[];
      note: string;
    }>();
    expect(matches).toEqual([]);
    expect(pages.length).toBeGreaterThan(10);
    expect(note).toContain('page');
  });
});
