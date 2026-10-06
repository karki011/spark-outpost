import { describe, expect, it } from 'vitest';
import {
  FailureScanner,
  environmentAdvice,
  environmentProblem,
  failureIds,
  failureSignature,
  outputShape,
  unusableScopedForm,
} from './failures.ts';

const finished = (
  outputTail: string,
  exitCode: number | null = 1,
  argv = ['pnpm', 'run', 'test'],
) => ({
  argv,
  exitCode,
  outputTail,
});

describe('reading failures out of tool output', () => {
  it('names failing test files, type errors, tasks and lint files without line numbers', () => {
    const output = [
      ' FAIL  libs/a/src/a.test.ts > adds',
      ' ❯ |unit| libs/b/src/b.spec.tsx (2 tests | 1 failed)',
      '/repo/copy/libs/c/src/c.ts(12,4): error TS2322: no',
      'libs/d/src/d.ts:3:1 - error TS7006: implicit any',
      'Failed tasks:',
      '',
      '- design-system-mcp:build',
      '- dashboards-api:test',
      '',
      '@acme/web#lint: command (/repo/apps/web) pnpm run lint exited (1)',
      '/repo/copy/src/bad.ts',
      '  3:10  error  Unexpected any  no-explicit-any',
    ].join('\n');
    expect(failureIds(output, ['/repo/copy'])).toEqual([
      'lint src/bad.ts',
      'task @acme/web#lint',
      'task dashboards-api:test',
      'task design-system-mcp:build',
      'test libs/a/src/a.test.ts',
      'test libs/b/src/b.spec.tsx',
      'type libs/c/src/c.ts TS2322',
      'type libs/d/src/d.ts TS7006',
    ]);
  });

  it('reads lines split across chunks', () => {
    const scanner = new FailureScanner();
    scanner.push(' FAIL  src/a.te');
    scanner.push('st.ts > x\n FAIL  src/b.test.ts');
    expect(scanner.ids()).toEqual(['test src/a.test.ts', 'test src/b.test.ts']);
  });
});

describe('comparing with the base', () => {
  it('gives the same output one shape whatever the paths and numbers', () => {
    const before = outputShape('boom at /repo/base/src/a.ts after 1.2 s\n', ['/repo/base']);
    const same = outputShape('boom at /repo/copy/src/a.ts  after 31 s\n', ['/repo/copy']);
    expect(same).toBe(before);
    expect(outputShape('api.ts is broken\n', ['/repo/copy'])).not.toBe(before);
  });

  it('gives the same signature to the same failures in any order', () => {
    expect(failureSignature('pnpm test', ['b', 'a'], 1)).toBe(
      failureSignature('pnpm test', ['a', 'b'], 1),
    );
    expect(failureSignature('pnpm test', [], 1)).not.toBe(failureSignature('pnpm test', [], 2));
  });
});

describe('telling setup problems from failures', () => {
  it('recognises a registry login, an unreachable registry, missing dependencies and a missing tool', () => {
    expect(
      environmentProblem(finished('npm error code E401\nnpm error Unable to authenticate')),
    ).toBe('registry_login');
    expect(
      environmentProblem(
        finished('ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/x: ENOTFOUND'),
      ),
    ).toBe('offline');
    expect(
      environmentProblem(
        finished('Local package.json exists, but node_modules missing, did you mean to install?'),
      ),
    ).toBe('deps_missing');
    expect(environmentProblem(finished('sh: nx: command not found', 127))).toBe('command_missing');
    expect(environmentProblem(finished('spawn nope ENOENT', null, ['nope']))).toBe(
      'command_missing',
    );
  });

  it('recognises a refused registry request, a lockfile that does not match and the wrong Node version', () => {
    expect(environmentProblem(finished('npm error code E403\nnpm error 403 Forbidden - GET'))).toBe(
      'registry_login',
    );
    expect(
      environmentProblem(
        finished('ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"'),
      ),
    ).toBe('lockfile');
    expect(
      environmentProblem(finished('ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment')),
    ).toBe('node_version');
    expect(environmentProblem(finished('Vite requires Node.js version 20.19+ or 22.12+.'))).toBe(
      'node_version',
    );
    expect(environmentProblem(finished('npm warn EBADENGINE Unsupported engine'))).toBeNull();
    expect(environmentAdvice('node_version', finished(''))).toContain('Node.js version');
  });

  it('finds a setup problem anywhere in long output, not only in the kept tail', () => {
    const scanner = new FailureScanner();
    scanner.push(
      '> tool@1.0.0 prepare\nnpm error code E401\nnpm error Incorrect or missing password.\n',
    );
    scanner.push(`${'src/a.ts(1,1): error TS2307: Cannot find module tool\n'.repeat(400)}`);
    expect(scanner.environment()).toBe('registry_login');
    expect(environmentProblem({ ...finished('error TS2307'), setup: scanner.environment() })).toBe(
      'registry_login',
    );
  });

  it('does not join a network word and a package word that are far apart', () => {
    const scanner = new FailureScanner();
    scanner.push('GET /registry 200\n');
    scanner.push('ok\n'.repeat(5));
    scanner.push('Error: connect ECONNREFUSED 127.0.0.1:5432\n');
    expect(scanner.environment()).toBeNull();
  });

  it('leaves ordinary failures alone, even ones that mention a missing file or module', () => {
    expect(
      environmentProblem(finished("Error: ENOENT: no such file or directory, open 'x.json'")),
    ).toBeNull();
    expect(
      environmentProblem(finished("src/a.ts(1,1): error TS2307: Cannot find module './b'")),
    ).toBeNull();
    expect(environmentProblem(finished('AssertionError: user: not found'))).toBeNull();
  });

  it('says what to do in plain words', () => {
    const missing = finished('ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "nx" not found', 254);
    expect(environmentAdvice('command_missing', missing)).toContain('`nx` was not found');
    expect(environmentAdvice('registry_login', missing)).toContain('Run `npm login`');
  });

  it('treats an unknown flag or a missing tool as a narrowed form that cannot be used', () => {
    expect(unusableScopedForm(finished('Unknown arguments: files'))).toBe(true);
    expect(unusableScopedForm(finished('ERR_PNPM  Command "nx" not found', 254))).toBe(true);
    expect(unusableScopedForm(finished(' FAIL  a.test.ts'))).toBe(false);
  });
});
