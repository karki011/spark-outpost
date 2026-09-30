import { describe, expect, it } from 'vitest';
import { guideSections } from '../guide/sections.ts';
import type { SparkToolContext } from '../tool.ts';
import { guideTool } from './guide-tool.ts';

const context: SparkToolContext = {
  deps: {} as never,
  scope: { workspaceId: 'w', conversationId: null, runId: null },
};

describe('guideTool', () => {
  it('lists section ids and titles with no query or section', async () => {
    const result = (await guideTool.run({}, context)) as {
      sections: { id: string; title: string }[];
    };
    expect(result.sections.length).toBe(guideSections.length);
    expect(result.sections[0]).toHaveProperty('id');
    expect(result.sections[0]).toHaveProperty('title');
  });

  it('finds the autonomy/ship section first for a full-auto pull-request query', async () => {
    const result = (await guideTool.run({ query: 'full auto pull request' }, context)) as {
      matches: { id: string }[];
    };
    expect(['autonomy-levels', 'ship']).toContain(result.matches[0]?.id);
  });

  it('finds the worktrees section for "worktree"', async () => {
    const result = (await guideTool.run({ query: 'worktree' }, context)) as {
      matches: { id: string }[];
    };
    expect(result.matches.some((match) => match.id === 'worktrees')).toBe(true);
  });

  it('returns one exact section by id', async () => {
    const result = (await guideTool.run({ section: 'jev' }, context)) as {
      matches: { id: string; title: string; text: string }[];
    };
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.id).toBe('jev');
  });

  it('rejects an unknown section id with the list of known ids', async () => {
    await expect(guideTool.run({ section: 'not-a-real-section' }, context)).rejects.toThrow(/jev/);
  });

  it('returns no matches plus section titles for a query that matches nothing', async () => {
    const result = (await guideTool.run({ query: 'zzzznonexistentqueryxyz' }, context)) as {
      matches: unknown[];
      sections: unknown[];
      note: string;
    };
    expect(result.matches).toHaveLength(0);
    expect(result.sections.length).toBe(guideSections.length);
    expect(result.note).toBeTruthy();
  });

  it('every section id is unique and every text stays under 1,000 characters', () => {
    const ids = new Set(guideSections.map((section) => section.id));
    expect(ids.size).toBe(guideSections.length);
    for (const section of guideSections) {
      expect(section.text.length).toBeLessThan(1_000);
    }
  });

  it('keeps the whole index well under 20,000 characters', () => {
    const totalChars = guideSections.reduce((sum, section) => sum + section.text.length, 0);
    expect(totalChars).toBeLessThan(20_000);
  });
});
