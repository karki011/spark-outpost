import { describe, expect, it } from 'vitest';
import { bucketOf, projectMap, shouldMove, type SourceState } from './status.ts';

const states: (SourceState & { id: string })[] = [
  { id: '1', name: 'Todo', kind: 'todo' },
  { id: '2', name: 'Blocked', kind: 'started' },
  { id: '3', name: 'In Progress', kind: 'started' },
  { id: '4', name: 'Code Review', kind: 'started' },
  { id: '5', name: 'Done', kind: 'done' },
];

describe('ticket status mapping', () => {
  it('buckets states by kind, with review names as In review', () => {
    expect(states.map((state) => bucketOf(state))).toEqual([
      'todo',
      'in_progress',
      'in_progress',
      'in_review',
      'done',
    ]);
  });

  it('lets a project map a status name to a bucket', () => {
    const mapped = projectMap({ web: { in_review: 'Blocked' } }, 'WEB');
    expect(bucketOf({ name: 'blocked', kind: 'started' }, mapped)).toBe('in_review');
    expect(projectMap({ web: { in_review: 'Blocked' } }, 'API')).toEqual({});
    expect(projectMap({ web: { in_review: 'Blocked' } }, null)).toEqual({});
  });

  it('never moves a ticket backwards except to Done', () => {
    expect(shouldMove('todo', 'in_progress')).toEqual({ move: true });
    expect(shouldMove('in_progress', 'in_review')).toEqual({ move: true });
    expect(shouldMove('in_review', 'in_progress')).toMatchObject({ move: false });
    expect(shouldMove('done', 'in_review')).toMatchObject({ move: false });
    expect(shouldMove('in_review', 'in_review')).toEqual({
      move: false,
      reason: 'Already In review.',
    });
    expect(shouldMove('in_review', 'done')).toEqual({ move: true });
  });
});
