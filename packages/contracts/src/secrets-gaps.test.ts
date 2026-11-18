import { describe, expect, it } from 'vitest';
import {
  isSensitiveEnvKey,
  pastedSecretKinds,
  redactText,
  removePastedSecrets,
  secretKinds,
} from './secrets.ts';

const BASIC = 'dXNlcjpodW50ZXIy';
const PADDED_BASIC = 'YWRtaW46czNjcmV0IQ==';
const ENCODED_GITHUB = 'ghp%5Fabcdefghijklmnopqrstuvwxyz0123';

function expectStable(text: string) {
  const once = redactText(text);
  expect(redactText(once)).toBe(once);
  expect(pastedSecretKinds(removePastedSecrets(text))).toEqual([]);
}

describe('URL passwords with @ in them', () => {
  it.each([
    ['https://user:p@ss@host/path', 'https://user:[redacted:url_password]@host/path'],
    ['https://user:p@ss@w@rd@host', 'https://user:[redacted:url_password]@host'],
    ['https://user:p%40ss@host/x', 'https://user:[redacted:url_password]@host/x'],
    ['postgres://app:pa#ss@db:5432/x', 'postgres://app:[redacted:url_password]@db:5432/x'],
    ['https://u:secret@host?email=a@b.com', 'https://u:[redacted:url_password]@host?email=a@b.com'],
  ])('masks the whole password in %s', (text, expected) => {
    expect(redactText(`see ${text} now`)).toBe(`see ${expected} now`);
    expectStable(text);
  });

  it.each([
    ['an email in prose', 'Mail ana@example.com or bo@example.org about it.'],
    ['a mailto link', 'Write to mailto:ana@example.com today.'],
    ['a URL without a password', 'Open https://user@example.com/repo and https://example.com/a@b'],
    ['a query that looks like userinfo', 'https://host?x=a:b@c'],
  ])('leaves %s alone', (_name, text) => {
    expect(redactText(text)).toBe(text);
    expect(secretKinds(text)).toEqual([]);
  });

  it('scans a URL full of @ in linear time', () => {
    const text = `https://u:${'a@'.repeat(100_000)}host`;
    const started = Date.now();
    expect(redactText(text)).toBe('https://u:[redacted:url_password]@host');
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('Basic sign-in headers', () => {
  it.each([
    [`Authorization: Basic ${BASIC}`, 'Authorization: Basic [redacted:basic_auth]'],
    [
      `-H "Authorization: basic ${PADDED_BASIC}"`,
      '-H "Authorization: basic [redacted:basic_auth]"',
    ],
    [`Basic ${PADDED_BASIC}`, 'Basic [redacted:basic_auth]'],
    ['Basic Zx81kQ0pLm2nB7vC4tY9', 'Basic [redacted:basic_auth]'],
  ])('masks %s', (text, expected) => {
    expect(redactText(text)).toBe(expected);
    expect(pastedSecretKinds(text)).toEqual(['basic_auth']);
    expectStable(text);
  });

  it.each([
    'Basic settings are under General.',
    'See Basic examples and Basic concepts first.',
    'Basic authentication is described below.',
    'Authorization: Basic YOUR_CREDENTIALS',
    'Authorization: Basic <base64>',
  ])('leaves %s alone', (text) => {
    expect(redactText(text)).toBe(text);
    expect(pastedSecretKinds(text)).toEqual([]);
  });
});

describe('Bearer tokens without a digit', () => {
  it('masks a long mixed-case token', () => {
    const text = 'Authorization: Bearer abcDEFghiJKLmnoPQRstuVWX';
    expect(redactText(text)).toBe('Authorization: Bearer [redacted:bearer]');
    expect(pastedSecretKinds(text)).toEqual(['bearer']);
    expectStable(text);
  });

  it.each([
    'Send a Bearer token in the header.',
    'He was a bearer of bad news.',
    'curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE"',
    'Bearer authentication-required-for-this-call',
    'Bearer internationalization',
  ])('leaves %s alone', (text) => {
    expect(redactText(text)).toBe(text);
    expect(pastedSecretKinds(text)).toEqual([]);
  });
});

describe('percent-encoded tokens', () => {
  it.each([
    [`?access_token=${ENCODED_GITHUB}&page=2`, '?access_token=[redacted:github_token]&page=2'],
    ['?token=sk%2Dproj%2Dabcdefghij0123456789', '?token=[redacted:api_key]'],
    ['xoxb%2D1234567890%2D0987654321%2DAbCdEf', '[redacted:slack_token]'],
  ])('masks %s', (text, expected) => {
    expect(redactText(text)).toBe(expected);
    expectStable(text);
  });

  it('names the decoded kind when pasted', () => {
    expect(pastedSecretKinds(`My link has ${ENCODED_GITHUB} in it`)).toEqual(['github_token']);
  });

  it.each([
    'https://example.com/search?q=hello%20world%20and%20more%20words',
    '100%25 of the tests passed, 50%25 faster than before.',
  ])('leaves %s alone', (text) => {
    expect(redactText(text)).toBe(text);
    expect(pastedSecretKinds(text)).toEqual([]);
  });

  it('does not warn about an encoded prefix without a digit', () => {
    expect(pastedSecretKinds('Use sk%2Dlearn-pipeline-for-images in the notebook.')).toEqual([]);
  });

  it('scans a long word next to an escape in linear time', () => {
    const text = `${'a'.repeat(200_000)} %41`;
    const started = Date.now();
    expect(redactText(text)).toBe(text);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('invisible characters in variable names', () => {
  it.each([
    '﻿OPENAI_API_KEY=Zx81kQ0pLm2nB7vC4tY9wE3r',
    'GITHUB_TO​KEN=a8f9c2d1e7b6a5f4c3d2e1f0',
    'DB_PASS‌WORD=Zx81kQ0pLm2nB7vC4tY9wE3r',
    'STRIPE⁠_KEY=Zx81kQ0pLm2nB7vC4tY9wE3r',
    'export AUTH‍_SECRET=Zx81kQ0pLm2nB7vC4tY9wE3r',
  ])('still treats %j as secret', (line) => {
    expect(redactText(line)).not.toContain('Zx81kQ0pLm2nB7vC4tY9wE3r');
    expect(redactText(line)).not.toContain('a8f9c2d1e7b6a5f4c3d2e1f0');
    expect(pastedSecretKinds(`check this\n${line}\nthanks`)).toEqual(['env']);
    expectStable(line);
  });

  it('classifies keys with the invisible characters removed', () => {
    expect(isSensitiveEnvKey('API​_KEY')).toBe(true);
    expect(isSensitiveEnvKey('TO﻿KEN')).toBe(true);
    expect(isSensitiveEnvKey('NODE​_ENV')).toBe(false);
  });

  it('keeps ordinary variables visible', () => {
    const text = '﻿NODE_ENV=production\nPORT=3000';
    expect(redactText(text)).toBe(text);
  });
});
