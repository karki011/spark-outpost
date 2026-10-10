import { describe, expect, it } from 'vitest';
import { SetupScanner, environmentProblem } from './failures.ts';

const finished = (
  outputTail: string,
  exitCode: number | null = 1,
  argv = ['pnpm', 'run', 'test'],
) => ({
  argv,
  exitCode,
  outputTail,
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
  });

  it('finds a setup problem anywhere in long output, not only in the kept tail', () => {
    const scanner = new SetupScanner();
    scanner.push(
      '> tool@1.0.0 prepare\nnpm error code E401\nnpm error Incorrect or missing password.\n',
    );
    scanner.push(`${'src/a.ts(1,1): error TS2307: Cannot find module tool\n'.repeat(400)}`);
    expect(scanner.problem()).toBe('registry_login');
    expect(environmentProblem({ ...finished('error TS2307'), setup: scanner.problem() })).toBe(
      'registry_login',
    );
  });

  it('does not join a network word and a package word that are far apart', () => {
    const scanner = new SetupScanner();
    scanner.push('GET /registry 200\n');
    scanner.push('ok\n'.repeat(5));
    scanner.push('Error: connect ECONNREFUSED 127.0.0.1:5432\n');
    expect(scanner.problem()).toBeNull();
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
});
