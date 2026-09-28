import { describe, expect, it } from 'vitest';
import { apiBaseFor, parseRemoteUrl } from './remote.ts';

describe('remote URLs', () => {
  it.each([
    ['https://github.com/acme/widgets.git', 'github.com'],
    ['https://user@github.com/acme/widgets', 'github.com'],
    ['git@github.com:acme/widgets.git', 'github.com'],
    ['ssh://git@ssh.github.com:443/acme/widgets.git', 'github.com'],
    ['ssh://git@git.corp.example:2222/acme/widgets.git', 'git.corp.example'],
    ['https://git.corp.example/acme/widgets/', 'git.corp.example'],
  ])('reads %s', (url, host) => {
    expect(parseRemoteUrl(url)).toEqual({ host, owner: 'acme', name: 'widgets' });
  });

  it.each(['/tmp/bare.git', '../other', 'file:///tmp/x.git', 'https://github.com/acme', ''])(
    'is not a hosted repository: %s',
    (url) => expect(parseRemoteUrl(url)).toBeNull(),
  );

  it('uses the public API for github.com and /api/v3 for Enterprise hosts', () => {
    expect(apiBaseFor('github.com')).toBe('https://api.github.com');
    expect(apiBaseFor('git.corp.example')).toBe('https://git.corp.example/api/v3');
    expect(apiBaseFor('github.com', 'http://127.0.0.1:9/github/')).toBe(
      'http://127.0.0.1:9/github',
    );
  });
});
