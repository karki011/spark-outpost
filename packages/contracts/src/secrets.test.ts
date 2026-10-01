import { describe, expect, it } from 'vitest';
import { pastedSecretKinds, removePastedSecrets } from './secrets.ts';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('pastedSecretKinds', () => {
  it.each([
    ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv1234', 'api_key'],
    ['sk-proj-abcdefghijklmnop0123456789', 'api_key'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123', 'github_token'],
    ['github_pat_11ABCDEFG0123456789_abcdefghijklmnop', 'github_token'],
    ['AKIAIOSFODNN7EXAMPLE', 'aws_key'],
    ['xoxb-1234567890-0987654321-AbCdEfGhIjKl', 'slack_token'],
    [JWT, 'jwt'],
    [
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----',
      'private_key',
    ],
    ['OPENAI_API_KEY=Zx81kQ0pLm2nB7vC4tY9wE3r', 'env'],
    ['export GITHUB_TOKEN="a8f9c2d1e7b6a5f4c3d2e1f0"', 'env'],
  ])('finds %s', (secret, kind) => {
    expect(pastedSecretKinds(`Can you check this?\n${secret}\nThanks`)).toEqual([kind]);
  });

  it.each([
    [
      'plain prose',
      'Please refactor the sk-learn-pipeline-for-images module and the task-runner-for-builds one.',
    ],
    ['a code assignment', 'const apiKey = process.env.OPENAI_API_KEY;\napiKey = loadKey(config);'],
    [
      'a placeholder env file',
      'OPENAI_API_KEY=your-key-here\nGITHUB_TOKEN=<token>\nSECRET=changeme',
    ],
    ['a short password', 'DB_PASSWORD=hunter2'],
    ['an env value that is a variable', 'API_KEY=${OPENAI_API_KEY}'],
    ['a public key', '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh\n-----END PUBLIC KEY-----'],
    ['a bearer word in prose', 'Bearer authentication is described below.'],
    [
      'a TypeScript snippet',
      'function token(input: string) {\n  return input.split(".").at(-1);\n}',
    ],
    ['a hash in a commit', 'Fixed in 3f2a9c1b7e4d6a8f0c2e5b9d1a7f3c6e8b0d2a4f, see the PR.'],
    ['already redacted text', 'OPENAI_API_KEY=[redacted:env] and [removed]'],
  ])('ignores %s', (_name, text) => {
    expect(pastedSecretKinds(text)).toEqual([]);
  });
});

describe('removePastedSecrets', () => {
  it('replaces each secret with [removed] and keeps the rest', () => {
    const text = [
      'My key is sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv1234, can you fix auth?',
      'OPENAI_API_KEY=Zx81kQ0pLm2nB7vC4tY9wE3r',
      'NODE_ENV=production',
    ].join('\n');
    expect(removePastedSecrets(text)).toBe(
      [
        'My key is [removed], can you fix auth?',
        'OPENAI_API_KEY=[removed]',
        'NODE_ENV=production',
      ].join('\n'),
    );
  });

  it('leaves text without secrets unchanged', () => {
    const text = 'const apiKey = process.env.OPENAI_API_KEY;';
    expect(removePastedSecrets(text)).toBe(text);
  });

  it('leaves nothing for detection afterwards', () => {
    const text = `token: ${JWT}\nAWS AKIAIOSFODNN7EXAMPLE\nxoxb-1234567890-0987654321-AbCdEfGhIjKl`;
    expect(pastedSecretKinds(removePastedSecrets(text))).toEqual([]);
  });
});
