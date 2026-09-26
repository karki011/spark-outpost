import { describe, expect, it } from 'vitest';
import {
  isSensitiveEnvKey,
  mentionsSecretFile,
  redactText,
  redactValue,
  sensitiveFieldKind,
  storableText,
} from './redact.ts';

describe('redactText', () => {
  it.each([
    ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv', '[redacted:api_key]'],
    ['sk-proj-abcdefghijklmnopqrstuvwx', '[redacted:api_key]'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123', '[redacted:github_token]'],
    ['gho_abcdefghijklmnopqrstuvwxyz0123', '[redacted:github_token]'],
    ['github_pat_11ABCDEFG0123456789_abcdefghijklmnop', '[redacted:github_token]'],
    ['AKIAIOSFODNN7EXAMPLE', '[redacted:aws_key]'],
    ['ASIAIOSFODNN7EXAMPLE', '[redacted:aws_key]'],
    [
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      '[redacted:jwt]',
    ],
  ])('replaces %s', (secret, replacement) => {
    expect(redactText(`before ${secret} after`)).toBe(`before ${replacement} after`);
  });

  it('keeps the Bearer scheme and hides the token', () => {
    expect(redactText('Authorization: Bearer abc123def456ghi789')).toBe(
      'Authorization: Bearer [redacted:bearer]',
    );
    expect(redactText('Bearer authentication is described below')).toBe(
      'Bearer authentication is described below',
    );
  });

  it('redacts sensitive .env lines and keeps the others', () => {
    const env = [
      'OPENAI_API_KEY=sk-short',
      'export GITHUB_TOKEN="abc"',
      'DB_PASSWORD = hunter2',
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG',
      'client.secret=xyz',
      'NODE_ENV=production',
      'PORT=3000',
      'EMPTY_TOKEN=',
    ].join('\n');
    expect(redactText(env).split('\n')).toEqual([
      'OPENAI_API_KEY=[redacted:env]',
      'export GITHUB_TOKEN=[redacted:env]',
      'DB_PASSWORD = [redacted:env]',
      'AWS_SECRET_ACCESS_KEY=[redacted:env]',
      'client.secret=[redacted:env]',
      'NODE_ENV=production',
      'PORT=3000',
      'EMPTY_TOKEN=',
    ]);
  });

  it('redacts passwords in connection URLs', () => {
    expect(redactText('DATABASE=postgres://app:s3cret@localhost:5432/db')).toBe(
      'DATABASE=postgres://app:[redacted:url_password]@localhost:5432/db',
    );
  });

  it('redacts sensitive fields inside JSON text', () => {
    expect(redactText('{"apiKey": "abc", "name": "x", "inputTokens": 5, "token":"t"}')).toBe(
      '{"apiKey": "[redacted:api_key]", "name": "x", "inputTokens": 5, "token":"[redacted:token]"}',
    );
  });

  it('redacts private key blocks, even when cut off', () => {
    const key =
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n-----END OPENSSH PRIVATE KEY-----';
    expect(redactText(`key:\n${key}\nend`)).toBe('key:\n[redacted:private_key]\nend');
    expect(redactText('-----BEGIN RSA PRIVATE KEY-----\nMIIE')).toBe('[redacted:private_key]');
  });

  it('leaves ordinary text alone and is idempotent', () => {
    const text = 'The skeleton key is a sk- prefix. Tokens: 120 in, 60 out.';
    expect(redactText(text)).toBe(text);
    const once = redactText('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx');
    expect(redactText(once)).toBe(once);
  });
});

describe('sensitive names', () => {
  it.each([
    ['apiKey', 'api_key'],
    ['api_key', 'api_key'],
    ['accessToken', 'token'],
    ['token', 'token'],
    ['password', 'password'],
    ['clientSecret', 'secret'],
    ['Authorization', 'authorization'],
    ['credentials', 'credential'],
  ])('treats the field %s as %s', (key, kind) => {
    expect(sensitiveFieldKind(key)).toBe(kind);
  });

  it.each(['inputTokens', 'totalTokens', 'maxTokens', 'tokenType', 'authMethods', 'sessionId'])(
    'does not treat %s as sensitive',
    (key) => {
      expect(sensitiveFieldKind(key)).toBeNull();
    },
  );

  it('recognises sensitive env keys by their parts', () => {
    expect(isSensitiveEnvKey('STRIPE_KEY')).toBe(true);
    expect(isSensitiveEnvKey('OPENAIKEY')).toBe(true);
    expect(isSensitiveEnvKey('PGPASSWORD')).toBe(true);
    expect(isSensitiveEnvKey('KEYBOARD_LAYOUT')).toBe(false);
    expect(isSensitiveEnvKey('HOME')).toBe(false);
  });
});

describe('redactValue', () => {
  it('redacts sensitive fields and strings anywhere in a JSON value', () => {
    const value = {
      params: {
        headers: { authorization: 'Bearer abcdefgh12345678', accept: 'json' },
        env: [{ name: 'OPENAI_API_KEY', value: 'sk-proj-abcdefghijklmnopqrstuvwx' }],
        usage: { inputTokens: 10, token: null },
        nested: { password: { hint: 'x' } },
      },
    };
    expect(redactValue(value)).toEqual({
      params: {
        headers: { authorization: '[redacted:authorization]', accept: 'json' },
        env: [{ name: 'OPENAI_API_KEY', value: '[redacted:api_key]' }],
        usage: { inputTokens: 10, token: null },
        nested: { password: '[redacted:password]' },
      },
    });
  });

  it('makes strings storable as jsonb', () => {
    expect(storableText('a\u0000b\uD800c')).toBe('a�b�c');
    expect(storableText('ok 😀')).toBe('ok 😀');
    expect(redactValue({ 'k\u0000': 'v\u0000' })).toEqual({ 'k�': 'v�' });
  });
});

describe('mentionsSecretFile', () => {
  it('finds secret files in paths, commands, and nested input', () => {
    expect(mentionsSecretFile('/work/app/.env')).toBe(true);
    expect(mentionsSecretFile({ command: 'cat .env.local | head' })).toBe(true);
    expect(mentionsSecretFile({ command: ['cat', '/home/me/.ssh/id_ed25519'] })).toBe(true);
    expect(mentionsSecretFile([{ path: 'certs/server.pem' }])).toBe(true);
    expect(mentionsSecretFile({ command: "cat '.npmrc'" })).toBe(true);
  });

  it('ignores ordinary files and the .env example', () => {
    expect(mentionsSecretFile('/work/app/.env.example')).toBe(false);
    expect(mentionsSecretFile({ command: 'cat README.md src/env.ts' })).toBe(false);
    expect(mentionsSecretFile(null)).toBe(false);
  });
});
