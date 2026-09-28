import { describe, expect, it } from 'vitest';
import { ownersMatcher, parseCodeowners } from './owners.ts';

describe('CODEOWNERS', () => {
  it('lets the last matching rule win and supports globs', () => {
    const ownersOf = ownersMatcher(
      parseCodeowners('# comment\n*.ts @ts\ndocs/ @docs\n/apps/**/api/ @api\n'),
    );
    expect(ownersOf('src/a.ts')).toEqual(['@ts']);
    expect(ownersOf('docs/guide.md')).toEqual(['@docs']);
    expect(ownersOf('apps/web/api/client.ts')).toEqual(['@api']);
    expect(ownersOf('README.md')).toEqual([]);
  });
});
