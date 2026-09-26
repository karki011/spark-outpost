import { describe, expect, it } from 'vitest';
import { artifactMarkdown, planChanges, samePlan, type PlanEntry } from './artifacts.ts';

const entry = (
  content: string,
  status: PlanEntry['status'] = 'pending',
  priority: PlanEntry['priority'] = 'medium',
): PlanEntry => ({ content, status, priority });

describe('planChanges', () => {
  it('reports no changes for the same plan', () => {
    const plan = [entry('Read'), entry('Fix')];
    expect(planChanges(plan, plan)).toEqual({
      added: [],
      removed: [],
      statusChanged: [],
      replaced: false,
    });
  });

  it('treats status progress as an update of the same plan', () => {
    const changes = planChanges(
      [entry('Read'), entry('Fix'), entry('Test')],
      [entry('Read', 'completed'), entry('Fix', 'in_progress'), entry('Test')],
    );
    expect(changes.replaced).toBe(false);
    expect(changes.statusChanged).toEqual([
      { content: 'Read', from: 'pending', to: 'completed' },
      { content: 'Fix', from: 'pending', to: 'in_progress' },
    ]);
  });

  it('keeps a plan with half of its entries changed as an update', () => {
    const changes = planChanges(
      [entry('Read'), entry('Fix'), entry('Test')],
      [entry('Read'), entry('Fix'), entry('Add a test')],
    );
    expect(changes).toMatchObject({ added: ['Add a test'], removed: ['Test'], replaced: false });
  });

  it('marks a plan replaced when more than half of the entries changed', () => {
    const changes = planChanges(
      [entry('Fix the boundary'), entry('Update the changelog'), entry('Run tests')],
      [
        entry('Fix the boundary', 'completed'),
        entry('Check other callers'),
        entry('Add a midnight test'),
        entry('Run tests'),
      ],
    );
    expect(changes.added).toEqual(['Check other callers', 'Add a midnight test']);
    expect(changes.removed).toEqual(['Update the changelog']);
    expect(changes.replaced).toBe(true);
  });

  it('never calls the first plan a replacement', () => {
    expect(planChanges([], [entry('Read')]).replaced).toBe(false);
  });

  it('matches duplicate entries by their first occurrence', () => {
    const changes = planChanges([entry('Read'), entry('Read')], [entry('Read', 'completed')]);
    expect(changes.statusChanged).toHaveLength(1);
    expect(changes.removed).toEqual([]);
  });
});

describe('samePlan', () => {
  it('compares content, priority and status in order', () => {
    expect(samePlan([entry('A')], [entry('A')])).toBe(true);
    expect(samePlan([entry('A')], [entry('A', 'pending', 'high')])).toBe(false);
    expect(samePlan([entry('A'), entry('B')], [entry('B'), entry('A')])).toBe(false);
  });
});

describe('artifactMarkdown', () => {
  it('exports the latest plan as a checklist with its history', () => {
    const markdown = artifactMarkdown('plan', [
      {
        version: 1,
        createdAt: '2026-09-26T10:02:41.000Z',
        supersededBy: null,
        body: { entries: [entry('Read'), entry('Fix', 'pending', 'high')] },
      },
      {
        version: 2,
        createdAt: '2026-09-26T10:04:00.000Z',
        supersededBy: null,
        body: {
          entries: [
            entry('Read', 'completed'),
            entry('Fix', 'in_progress', 'high'),
            entry('Test', 'pending', 'low'),
          ],
        },
      },
    ]);
    expect(markdown).toBe(
      [
        '# Plan v2',
        '',
        '- [x] Read',
        '- [ ] Fix (in progress) · high priority',
        '- [ ] Test · low priority',
        '',
        '## History',
        '',
        '- v1 · 2026-09-26 10:02 · first plan, 2 entries',
        '- v2 · 2026-09-26 10:04 · 1 added, 1 done, 1 started',
        '',
      ].join('\n'),
    );
  });

  it('counts failed steps apart from started ones', () => {
    const markdown = artifactMarkdown('plan', [
      { version: 1, createdAt: '2026-09-26T10:02:41.000Z', body: { entries: [entry('A')] } },
      {
        version: 2,
        createdAt: '2026-09-26T10:03:00.000Z',
        body: { entries: [entry('A', 'failed')] },
      },
    ]);
    expect(markdown).toContain('- [ ] A (failed)');
    expect(markdown).toContain('- v2 · 2026-09-26 10:03 · 1 failed');
  });

  it('says when there is no plan yet', () => {
    expect(artifactMarkdown('plan', [])).toContain('No plan yet.');
  });
});
