import { describe, expect, it } from 'vitest';
import {
  FailureScanner,
  compareWithBase,
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
  const named = (failures: string[]) => ({ failures, shape: 'any' });

  it('blames the change only for failures the base does not have', () => {
    const base = { passed: false, failures: ['test a.test.ts'], shape: 'base' };
    expect(compareWithBase(named(['test a.test.ts']), base).fromChange).toBe(false);
    expect(compareWithBase(named(['test a.test.ts', 'test b.test.ts']), base)).toEqual({
      shared: ['test a.test.ts'],
      added: ['test b.test.ts'],
      fromChange: true,
    });
    expect(compareWithBase(named([]), { passed: true, failures: [], shape: '' }).fromChange).toBe(
      true,
    );
  });

  it('compares the output itself when it names no failures, ignoring paths and numbers', () => {
    const roots = ['/repo/copy'];
    const before = outputShape('boom at /repo/base/src/a.ts after 1.2 s\n', ['/repo/base']);
    const same = outputShape('boom at /repo/copy/src/a.ts  after 31 s\n', roots);
    const other = outputShape('api.ts is broken\n', roots);
    const base = { passed: false, failures: [], shape: before };
    expect(compareWithBase({ failures: [], shape: same }, base).fromChange).toBe(false);
    expect(compareWithBase({ failures: [], shape: other }, base).fromChange).toBe(true);
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
