import { describe, expect, it } from 'vitest';
import { guideSections } from '../guide/sections.ts';
import { searchGuide } from '../guide/search.ts';
import type { SparkToolContext } from '../tool.ts';
import { guideTool } from './guide-tool.ts';

const SETTING_LABELS = [
  'AI providers',
  'Models',
  'Usage',
  'Projects',
  'Connectors',
  'MCP servers',
  'Appearance',
  'Reset',
  'What should Spark call you?',
  'Personality',
  'How much Spark does alone',
  'Spend cap per task',
  'If you don’t answer a question',
  'When checks still fail in Full auto',
  'Morning brief',
  'Status companion',
  'Check changes with Jev',
  'Builders at once',
  'Where Spark works',
  'Keep my API keys',
];

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

  it('answers how to make Builders run one at a time from the Builders at once section', async () => {
    for (const query of [
      'How do I make Builders run one at a time?',
      'builders at once',
      'run builders serial instead of parallel',
      'parallel builder slots',
    ]) {
      const result = (await guideTool.run({ query }, context)) as { matches: { id: string }[] };
      expect(result.matches[0]?.id, query).toBe('builders-at-once');
    }
  });

  it.each([
    ['where spark works', 'worktrees'],
    ['work in my files instead of a worktree', 'worktrees'],
    ['force push hold card', 'safety-floor'],
    ['Ask mode run a command', 'ask-vs-do'],
    ['today so far', 'today-so-far'],
    ['link a ticket to a chat', 'tickets'],
    ['map page unmatched api', 'map'],
    ['spark action card confirm', 'spark-own-tools'],
    ['urgent ticket not started', 'attention-brief'],
  ])('finds %s in the %s section', (query, id) => {
    const top = searchGuide(guideSections, query, 3).map((result) => result.id);
    expect(top).toContain(id);
  });

  it.each(SETTING_LABELS)('covers the setting "%s" in a section that search finds', (label) => {
    const covering = guideSections.filter((section) =>
      section.text.toLowerCase().includes(label.toLowerCase()),
    );
    expect(covering.length, label).toBeGreaterThan(0);
    const top = searchGuide(guideSections, label, 5).map((result) => result.id);
    expect(
      covering.some((section) => top.includes(section.id)),
      label,
    ).toBe(true);
  });
});
