import { describe, expect, it } from 'vitest';
import {
  configuredChecks,
  detectChecks,
  kindOf,
  packageManager,
  type ProjectFiles,
} from './detect.ts';

function files(scripts: Record<string, string> | null, present: string[] = []): ProjectFiles {
  const packageJson = scripts ? JSON.stringify({ scripts }) : null;
  return {
    packageJson,
    pyproject: null,
    present: new Set([...(packageJson ? ['package.json'] : []), ...present]),
  };
}

describe('detecting a project’s checks', () => {
  it('runs typecheck, lint and test scripts in that order with the lockfile’s package manager', () => {
    const found = detectChecks(
      files({ test: 'vitest run', lint: 'eslint .', typecheck: 'tsc -b', dev: 'vite' }, [
        'pnpm-lock.yaml',
      ]),
    );
    expect(found.map((check) => [check.kind, check.command])).toEqual([
      ['typecheck', 'pnpm run typecheck'],
      ['lint', 'pnpm run lint'],
      ['test', 'pnpm run test'],
    ]);
  });

  it('uses npm test without a lockfile and skips placeholder and watch scripts', () => {
    expect(detectChecks(files({ test: 'node --test' })).map((check) => check.argv)).toEqual([
      ['npm', 'test'],
    ]);
    expect(detectChecks(files({ test: 'echo "Error: no test specified" && exit 1' }))).toEqual([]);
    expect(detectChecks(files({ test: 'jest --watch' }))).toEqual([]);
    expect(detectChecks(files({ 'type-check': 'tsc' }))[0]?.command).toBe('npm run type-check');
  });

  it('falls back to common tool configs and ignores broken package.json files', () => {
    expect(detectChecks(files(null, ['Cargo.toml']))[0]?.command).toBe('cargo test --quiet');
    expect(detectChecks(files(null, ['go.mod']))[0]?.command).toBe('go test ./...');
    expect(detectChecks(files(null, ['pytest.ini']))[0]?.command).toBe('python3 -m pytest -q');
    const broken = { packageJson: '{', pyproject: null, present: new Set(['package.json']) };
    expect(detectChecks(broken)).toEqual([]);
    expect(packageManager(new Set(['yarn.lock']))).toBe('yarn');
  });

  it('parses configured commands without a shell and refuses chained ones', () => {
    const checks = configuredChecks([
      'npm run lint',
      'node "check it.mjs"',
      'npm test && rm -rf /',
    ]);
    expect(checks.map((check) => check.argv)).toEqual([
      ['npm', 'run', 'lint'],
      ['node', 'check it.mjs'],
    ]);
    expect(kindOf(['npx', 'tsc', '--noEmit'])).toBe('typecheck');
    expect(kindOf(['node', 'check.mjs'])).toBe('custom');
  });
});
