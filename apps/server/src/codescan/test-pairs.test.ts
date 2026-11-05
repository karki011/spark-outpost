import { describe, expect, it } from 'vitest';
import { isTestFile, pairTests } from './test-pairs.ts';

describe('pairTests', () => {
  it('pairs sources with tests by name, nearby or in the same package', () => {
    const paths = [
      'src/chart.ts',
      'src/chart.test.ts',
      'src/util/index.ts',
      'src/other/index.test.ts',
      'src/store.ts',
      'test/store.db.test.ts',
      'pkg/server.go',
      'pkg/server_test.go',
      'app/models.py',
      'tests/test_models.py',
      'src/lonely.ts',
    ];
    const tested = pairTests(paths, () => 'one');
    expect([...tested].sort()).toEqual([
      'app/models.py',
      'pkg/server.go',
      'src/chart.ts',
      'src/store.ts',
    ]);
    expect(isTestFile('src/__tests__/chart.ts')).toBe(true);
    expect(isTestFile('src/chart.ts')).toBe(false);
  });
});
