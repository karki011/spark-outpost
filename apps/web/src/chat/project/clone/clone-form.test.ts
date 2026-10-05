import { describe, expect, it } from 'vitest';
import {
  canClone,
  EMPTY_FORM,
  formProblems,
  joinPath,
  matchingRepos,
  splitDestination,
  withName,
  withUrl,
} from './clone-form.ts';

describe('clone form', () => {
  it('names the folder after the repository until the name is edited', () => {
    const pasted = withUrl(EMPTY_FORM, 'https://github.com/acme/widgets.git');
    expect(pasted.name).toBe('widgets');
    const renamed = withName(pasted, 'my-widgets');
    expect(withUrl(renamed, 'git@github.com:acme/other.git').name).toBe('my-widgets');
  });

  it('stays quiet about empty fields and explains bad ones', () => {
    expect(formProblems(EMPTY_FORM)).toEqual({ url: null, name: null });
    expect(formProblems(withUrl(EMPTY_FORM, 'file:///tmp/x')).url).toMatch(/file address/);
    expect(formProblems(withName(EMPTY_FORM, '../x')).name).toMatch(/slash/);
    expect(formProblems(withName(EMPTY_FORM, '')).name).toMatch(/Give the folder a name/);
  });

  it('allows cloning only with a valid address, name and parent folder', () => {
    const form = withUrl(EMPTY_FORM, 'https://github.com/acme/widgets.git');
    expect(canClone(form, '/Users/me/Documents')).toBe(true);
    expect(canClone(form, null)).toBe(false);
    expect(canClone(withName(form, '.git'), '/Users/me/Documents')).toBe(false);
    expect(canClone(withUrl(form, 'https://me:pw@github.com/a/b'), '/Users/me')).toBe(false);
  });

  it('builds and splits the final path', () => {
    expect(joinPath('/Users/me/Documents/', ' widgets ')).toBe('/Users/me/Documents/widgets');
    expect(splitDestination('/Users/me/Documents/widgets')).toEqual({
      parent: '/Users/me/Documents',
      name: 'widgets',
    });
  });

  it('filters repositories by any part of the name', () => {
    const repos = [{ slug: 'acme/widgets' }, { slug: 'acme/Gadgets' }, { slug: 'octo/notes' }];
    expect(matchingRepos(repos, 'GET', 10).map((repo) => repo.slug)).toEqual([
      'acme/widgets',
      'acme/Gadgets',
    ]);
    expect(matchingRepos(repos, '', 2)).toHaveLength(2);
  });
});
