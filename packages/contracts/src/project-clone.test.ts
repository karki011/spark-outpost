import { describe, expect, it } from 'vitest';
import { CLONE_NAME_MAX, cloneNameProblem, parseCloneUrl } from './project-clone.ts';

const refused = (url: string, options = {}) => {
  const result = parseCloneUrl(url, options);
  return result.ok ? null : result.message;
};

describe('clone addresses', () => {
  it.each([
    ['https://github.com/acme/widgets.git', 'https', 'github.com', 'widgets'],
    ['https://github.com/acme/widgets', 'https', 'github.com', 'widgets'],
    ['  https://GitHub.com/acme/Widgets.git/  ', 'https', 'github.com', 'Widgets'],
    ['git@github.com:acme/widgets.git', 'ssh', 'github.com', 'widgets'],
    ['ssh://git@github.com/acme/widgets.git', 'ssh', 'github.com', 'widgets'],
    ['ssh://git@ghe.example.com:2222/team/app.git', 'ssh', 'ghe.example.com', 'app'],
    ['gitlab.example.com:group/sub/tool.git', 'ssh', 'gitlab.example.com', 'tool'],
  ])('accepts %s', (url, transport, host, name) => {
    const result = parseCloneUrl(url);
    expect(result).toEqual({ ok: true, source: { url: url.trim(), transport, host, name } });
  });

  it.each([
    ['file:///Users/me/code/app.git', /file address/],
    ['/Users/me/code/app', /folder on this Mac/],
    ['./app', /folder on this Mac/],
    ['../app.git', /folder on this Mac/],
    ['~/code/app', /folder on this Mac/],
    ['ext::sh -c touch% /tmp/pwned', /space/],
    ['ext::sh', /helper program/],
    ['fd::17/foo', /helper program/],
    ['git://github.com/acme/widgets.git', /git:\/\//],
    ['http://github.com/acme/widgets.git', /http:\/\//],
    ['ftp://example.com/repo.git', /ftp:\/\//],
    ['https://user:hunter2@github.com/acme/widgets.git', /username or password/],
    ['https://ghp_abcdefghijklmnop@github.com/acme/widgets.git', /username or password/],
    ['ssh://git:hunter2@github.com/acme/widgets.git', /username or password/],
    ['user:hunter2@github.com:acme/widgets.git', /username or password/],
    ['--upload-pack=touch /tmp/pwned', /space/],
    ['--upload-pack=evil', /not a repository address/],
    ['-oProxyCommand=evil@host:repo', /not a repository address/],
    ['git@-oProxyCommand=evil:repo', /not a repository address/],
    ['https://github.com', /missing a host or a repository/],
    ['https://github.com/acme/widgets.git?token=abc', /not valid/],
    ['ssh://-oProxyCommand=evil@github.com/acme/widgets.git', /missing a host/],
    ['https://[::1]/acme/widgets.git', /not valid/],
    ['https://github.com/acme/wid gets', /space/],
    ['widgets', /not a repository address/],
    ['', /Paste an https/],
  ])('refuses %s', (url, message) => {
    expect(refused(url)).toMatch(message);
  });

  it('never repeats a pasted password in the refusal', () => {
    expect(refused('https://user:hunter2@github.com/acme/widgets.git')).not.toContain('hunter2');
  });

  it('takes a file address only when the caller allows it', () => {
    expect(refused('file:///tmp/source/widgets.git')).toMatch(/file address/);
    expect(parseCloneUrl('file:///tmp/source/widgets.git', { allowFile: true })).toEqual({
      ok: true,
      source: {
        url: 'file:///tmp/source/widgets.git',
        transport: 'file',
        host: '',
        name: 'widgets',
      },
    });
  });

  it('leaves the folder name empty when the address has no usable one', () => {
    const result = parseCloneUrl('https://example.com/team/.git');
    expect(result.ok && result.source.name).toBe('');
  });
});

describe('clone folder names', () => {
  it.each(['widgets', 'my-app_2', 'app.v2', '_private', '9lives'])('accepts %s', (name) => {
    expect(cloneNameProblem(name)).toBeNull();
  });

  it.each([
    ['', /Give the folder a name/],
    ['   ', /Give the folder a name/],
    ['a/b', /slash/],
    ['a\\b', /slash/],
    ['..', /dot or a dash/],
    ['.hidden', /dot or a dash/],
    ['-rf', /dot or a dash/],
    ['my app', /letters, numbers/],
    ['app\u0000', /letters, numbers/],
    ['x'.repeat(CLONE_NAME_MAX + 1), /characters or fewer/],
  ])('refuses %j', (name, message) => {
    expect(cloneNameProblem(name)).toMatch(message);
  });
});
