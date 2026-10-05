import { describe, expect, it } from 'vitest';
import type { CheckCommand, ProjectFiles } from './detect.ts';
import { detectChecks } from './detect.ts';
import { scopedCheck, scopedSuggestion, type ChangeFacts } from './scope.ts';

function project(
  scripts: Record<string, string>,
  present: string[],
  manager?: string,
): ProjectFiles {
  return {
    packageJson: JSON.stringify({ scripts, ...(manager ? { packageManager: manager } : {}) }),
    present: new Set(present),
    pyproject: null,
  };
}

function facts(
  files: ProjectFiles,
  changed: string[],
  packageDirs: string[] | null = null,
): ChangeFacts {
  return { files, changed, existing: changed, packageDirs };
}

const testCheck = (files: ProjectFiles): CheckCommand =>
  detectChecks(files).find((check) => check.kind === 'test')!;

describe('narrowing a check to what changed', () => {
  it('uses nx affected with the changed files when the script runs every nx project', () => {
    const files = project({ test: 'nx run-many -t test --all --parallel=3' }, [
      'nx.json',
      'pnpm-lock.yaml',
    ]);
    const scoped = scopedCheck(
      testCheck(files),
      facts(files, ['libs/a/src/a.ts', 'libs/a/src/b.ts']),
    );
    expect(scoped).toEqual({
      check: {
        kind: 'test',
        command:
          'pnpm exec nx affected -t test --parallel=3 --files=libs/a/src/a.ts,libs/a/src/b.ts',
        argv: [
          'pnpm',
          'exec',
          'nx',
          'affected',
          '-t',
          'test',
          '--parallel=3',
          '--files=libs/a/src/a.ts,libs/a/src/b.ts',
        ],
      },
      scope: { whole: 'pnpm run test', label: 'affected projects' },
    });
  });

  it('filters turbo and pnpm workspaces to the changed packages and what depends on them', () => {
    const turbo = project({ test: 'turbo run test' }, ['turbo.json', 'package-lock.json']);
    expect(
      scopedCheck(testCheck(turbo), facts(turbo, ['apps/web/a.ts'], ['apps/web']))?.check.command,
    ).toBe('npx --no-install turbo run test --filter=...{./apps/web}');
    const pnpm = project({ test: 'pnpm -r test' }, ['pnpm-workspace.yaml', 'pnpm-lock.yaml']);
    expect(
      scopedCheck(
        testCheck(pnpm),
        facts(pnpm, ['libs/a/a.ts', 'libs/b/b.ts'], ['libs/a', 'libs/b']),
      )?.check.argv,
    ).toEqual(['pnpm', '--filter', '...{./libs/a}', '--filter', '...{./libs/b}', 'test']);
  });

  it('runs only related tests for plain vitest and jest', () => {
    const vitest = project({ test: 'vitest run' }, ['pnpm-lock.yaml']);
    expect(scopedCheck(testCheck(vitest), facts(vitest, ['src/a.ts']))?.check.command).toBe(
      'pnpm exec vitest related --run --passWithNoTests src/a.ts',
    );
    const jest = project({ test: 'jest --ci' }, ['yarn.lock']);
    expect(scopedCheck(testCheck(jest), facts(jest, ['src/a.ts']))?.check.command).toBe(
      'yarn jest --ci --passWithNoTests --findRelatedTests src/a.ts',
    );
  });

  it('keeps the project’s own script whenever it is not sure', () => {
    const nx = project({ test: 'nx run-many -t test' }, ['nx.json']);
    const check = testCheck(nx);
    expect(
      scopedCheck(check, facts(project({ test: 'nx run-many -t test' }, []), ['a.ts'])),
    ).toBeNull();
    expect(scopedCheck(check, facts(nx, []))).toBeNull();
    expect(
      scopedCheck(
        check,
        facts(
          nx,
          Array.from({ length: 51 }, (_, index) => `f${index}.ts`),
        ),
      ),
    ).toBeNull();
    for (const script of [
      'nx run-many -t test -p app',
      'nx affected -t test',
      'nx test app',
      'node run.js && nx run-many -t test',
    ]) {
      const files = project({ test: script }, ['nx.json']);
      expect(scopedCheck(testCheck(files), facts(files, ['a.ts'])), script).toBeNull();
    }
    const turbo = project({ test: 'turbo run test' }, ['turbo.json']);
    expect(scopedCheck(testCheck(turbo), facts(turbo, ['package.json'], null))).toBeNull();
    const filtered = project({ test: 'turbo run test --filter=web' }, ['turbo.json']);
    expect(scopedCheck(testCheck(filtered), facts(filtered, ['a.ts'], ['apps/web']))).toBeNull();
    const custom = project({ test: 'node scripts/test.js' }, ['nx.json']);
    expect(scopedCheck(testCheck(custom), facts(custom, ['a.ts']))).toBeNull();
  });

  it('suggests a narrower command for the tool the project has', () => {
    const nx = project({ test: 'node all.js' }, ['nx.json', 'pnpm-lock.yaml']);
    expect(scopedSuggestion(testCheck(nx), nx)).toBe('pnpm exec nx affected -t test');
    const plain = project({ test: 'node all.js' }, []);
    expect(scopedSuggestion(testCheck(plain), plain)).toBeNull();
  });
});

describe('choosing the package manager up front', () => {
  it('prefers the packageManager field, then the lockfile, then npm', () => {
    const declared = project({ test: 'vitest run' }, ['package-lock.json'], 'pnpm@9.1.0');
    expect(detectChecks(declared)[0]!.command).toBe('pnpm run test');
    expect(detectChecks(project({ test: 'vitest run' }, ['yarn.lock']))[0]!.command).toBe(
      'yarn run test',
    );
    expect(detectChecks(project({ test: 'vitest run' }, []))[0]!.command).toBe('npm test');
  });
});
