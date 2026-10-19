import { describe, expect, it } from 'vitest';
import { maskUsername, signInOriginOf, signInOriginProblem, signInSites } from './sign-ins.ts';

describe('the site of a saved sign-in', () => {
  it.each([
    ['https://staging.example.com/login?next=1', 'https://staging.example.com'],
    ['staging.example.com', 'https://staging.example.com'],
    ['https://staging.example.com:8443', 'https://staging.example.com:8443'],
    ['localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:5173/sign-in', 'http://127.0.0.1:5173'],
    ['http://[::1]:8080', 'http://[::1]:8080'],
    ['http://app.localhost', 'http://app.localhost'],
    ['shop.test:4000', 'http://shop.test:4000'],
  ])('reads %s as %s', (typed, origin) => {
    expect(signInOriginOf(typed)).toBe(origin);
  });

  it.each([
    'http://staging.example.com',
    'ftp://staging.example.com',
    'file:///tmp/login.html',
    'https://user:secret@staging.example.com',
    'javascript:alert(1)',
    'about:blank',
    'sign in page',
    '',
  ])('refuses %s', (typed) => {
    expect(signInOriginOf(typed)).toBeNull();
  });
});

describe('matching a tab to a saved sign-in', () => {
  const saved = 'https://example.com';

  it('accepts any page of exactly that origin', () => {
    expect(signInOriginProblem([saved], 'https://example.com/login?next=%2F#top')).toBeNull();
    expect(signInOriginProblem(['http://localhost:3000'], 'http://localhost:3000/')).toBeNull();
    expect(signInOriginProblem(['http://shop.test'], 'http://shop.test/account')).toBeNull();
  });

  it.each([
    ['a look-alike host', 'https://example.com.evil.test/login'],
    ['a subdomain', 'https://login.example.com/'],
    ['the parent domain spelled as a path', 'https://evil.test/example.com'],
    ['another port', 'https://example.com:8443/login'],
    ['plain http', 'http://example.com/login'],
    ['the host as a username', 'https://example.com@evil.test/login'],
    ['a trailing-dot host', 'https://example.com./login'],
    ['a file', 'file:///example.com/login.html'],
    ['a blank tab', 'about:blank'],
    ['nonsense', 'not a url'],
  ])('refuses %s', (_name, page) => {
    expect(signInOriginProblem([saved], page)).toEqual(expect.any(String));
  });

  it('refuses plain http on a host that is not local, even when it was saved that way', () => {
    expect(
      signInOriginProblem(['http://intranet.example.com'], 'http://intranet.example.com/'),
    ).toEqual(expect.any(String));
  });

  it('refuses a local page for a sign-in saved for another local port', () => {
    expect(signInOriginProblem(['http://localhost:3000'], 'http://localhost:3001/')).toEqual(
      expect.any(String),
    );
    expect(signInOriginProblem(['http://localhost:3000'], 'http://127.0.0.1:3000/')).toEqual(
      expect.any(String),
    );
  });
});

describe('a sign-in with several sites', () => {
  const sites = signInSites({
    origin: 'https://app.cloudzero.example',
    sites: [
      'https://auth.cloudzero.example',
      'https://cloudzero.okta.example',
      'https://app.cloudzero.example',
    ],
  });

  it('lists the start site first and each site once', () => {
    expect(sites).toEqual([
      'https://app.cloudzero.example',
      'https://auth.cloudzero.example',
      'https://cloudzero.okta.example',
    ]);
  });

  it('types on any listed site and names the list and the tab when it is elsewhere', () => {
    expect(signInOriginProblem(sites, 'https://cloudzero.okta.example/login/step')).toBeNull();
    expect(signInOriginProblem(sites, 'https://auth.cloudzero.example/u/login')).toBeNull();
    const elsewhere = signInOriginProblem(sites, 'https://accounts.google.example/signin');
    expect(elsewhere).toContain(
      'types only on https://app.cloudzero.example, https://auth.cloudzero.example or https://cloudzero.okta.example',
    );
    expect(elsewhere).toContain('the tab is on https://accounts.google.example');
    expect(elsewhere).toContain('Add this site');
  });

  it('refuses everything when one listed site is not a valid sign-in site', () => {
    expect(
      signInOriginProblem(['https://app.example', 'http://auth.example'], 'https://app.example/'),
    ).toContain('not valid');
    expect(signInOriginProblem([], 'https://app.example/')).toContain('not valid');
  });
});

describe('masking a username', () => {
  it('keeps the first character and the mail domain', () => {
    expect(maskUsername('alice@example.com')).toBe('a•••@example.com');
    expect(maskUsername('admin')).toBe('a•••');
    expect(maskUsername('@handle')).toBe('@•••');
  });
});
