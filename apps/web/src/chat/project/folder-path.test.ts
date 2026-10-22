import { describe, expect, it } from 'vitest';
import { breadcrumbs, typedFolderPath } from './folder-path.ts';

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

describe('typed folder paths', () => {
  it('keeps full paths and expands the home folder', () => {
    expect(typedFolderPath(' /Volumes/Work ', '/Users/sam')).toBe('/Volumes/Work');
    expect(typedFolderPath('~', '/Users/sam')).toBe('/Users/sam');
    expect(typedFolderPath('~/Code/app', '/Users/sam')).toBe('/Users/sam/Code/app');
  });

  it('refuses relative paths and ~ without a known home', () => {
    expect(typedFolderPath('Code', '/Users/sam')).toBeNull();
    expect(typedFolderPath('~other', '/Users/sam')).toBeNull();
    expect(typedFolderPath('~/Code', null)).toBeNull();
  });
});
