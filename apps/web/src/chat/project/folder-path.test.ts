import { describe, expect, it } from 'vitest';
import { breadcrumbs } from './folder-path.ts';

describe('breadcrumbs', () => {
  it('builds a clickable path for every folder from the root', () => {
    expect(breadcrumbs('/Users/sam/code')).toEqual([
      { name: '/', path: '/' },
      { name: 'Users', path: '/Users' },
      { name: 'sam', path: '/Users/sam' },
      { name: 'code', path: '/Users/sam/code' },
    ]);
  });

  it('returns only the root for the root folder', () => {
    expect(breadcrumbs('/')).toEqual([{ name: '/', path: '/' }]);
  });
});
