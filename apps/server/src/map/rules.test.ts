import { describe, expect, it } from 'vitest';
import { ruleCategory, ruleKind, type AreaFacts } from './rules.ts';

function facts(root: string, paths: string[], extra: Partial<AreaFacts> = {}): AreaFacts {
  const files = paths.map((path) => ({
    path,
    language: path.slice(path.lastIndexOf('.') + 1),
    routes: 0,
  }));
  return { root, source: 'folder', files, usedBy: 0, uses: 0, ...extra };
}

describe('rule labels', () => {
  it('infers the kind from tests, docs, folder names, routes and languages', () => {
    expect(ruleKind(facts('e2e', ['e2e/a.spec.ts', 'e2e/b.spec.ts']))).toBe('tests');
    expect(ruleKind(facts('docs', ['docs/a.md']))).toBe('docs');
    expect(ruleKind(facts('server/migrations', ['server/migrations/1.sql']))).toBe('data');
    expect(ruleKind(facts('web/cart', ['web/cart/a.tsx', 'web/cart/b.tsx']))).toBe('ui');
    const routed = facts('server/orders', ['server/orders/a.ts']);
    expect(
      ruleKind({ ...routed, files: [{ path: 'server/orders/a.ts', language: 'ts', routes: 2 }] }),
    ).toBe('api');
  });

  it('treats feature folders as features even inside shared library roots', () => {
    const lib = facts('libs/features/billing/domain', ['libs/features/billing/domain/a.ts']);
    expect(ruleCategory(lib, 'domain')).toBe('feature');
    expect(ruleCategory(facts('libs/ui/table', ['libs/ui/table/a.tsx']), 'ui')).toBe('shared');
    expect(
      ruleCategory(facts('src/util', ['src/util/a.ts'], { usedBy: 4, uses: 1 }), 'domain'),
    ).toBe('shared');
    expect(ruleCategory(facts('src/db', ['src/db/a.ts']), 'data')).toBe('core');
    expect(ruleCategory(facts('src/cart', ['src/cart/a.ts']), 'domain')).toBe('feature');
  });
});
