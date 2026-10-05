import { describe, expect, it } from 'vitest';
import { classifyCloneFailure, cloneFailure } from './clone-failure.ts';

const TOKEN = 'ghu_plantedTokenValue0123456789abcdefghij';

describe('clone failures', () => {
  it.each([
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'auth'],
    ["fatal: Authentication failed for 'https://github.com/acme/private.git/'", 'auth'],
    [
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
      'auth',
    ],
    ['Host key verification failed.', 'auth'],
    [
      "remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found",
      'not_found',
    ],
    ["fatal: '/tmp/none.git' does not appear to be a git repository", 'not_found'],
    [
      "fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com",
      'network',
    ],
    ['fatal: the remote end hung up unexpectedly\nfatal: early EOF', 'network'],
    ["fatal: destination path 'x' already exists and is not an empty directory.", 'destination'],
    ['fatal: write error: No space left on device', 'disk'],
    ['fatal: something unusual', 'other'],
  ])('reads %j as %s', (output, kind) => {
    expect(classifyCloneFailure(output)).toBe(kind);
  });

  it('redacts the token Spark supplied and any password in an address', () => {
    const failure = cloneFailure(
      `Cloning into 'app'...\nReceiving objects:  10% (1/10)\nfatal: unable to access 'https://x-access-token:${TOKEN}@github.com/acme/app.git/': The requested URL returned error: 403 ${TOKEN}`,
      [TOKEN],
    );
    expect(failure.kind).toBe('auth');
    expect(failure.detail).not.toContain(TOKEN);
    expect(failure.detail).not.toContain('Receiving objects');
    expect(failure.detail).toContain('[redacted:');
    expect(failure.summary).toMatch(/Sign-in failed/);
  });

  it('keeps only the last few lines of git output', () => {
    const output = Array.from({ length: 20 }, (_, index) => `error: line ${index}`).join('\n');
    expect(cloneFailure(output, []).detail.split('\n')).toHaveLength(6);
  });
});
