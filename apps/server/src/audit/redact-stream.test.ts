import { describe, expect, it } from 'vitest';
import { createRedactionFilter } from './redact-stream.ts';
import { redactText } from './redact.ts';

function streamed(chunks: readonly string[], values: readonly string[] = []) {
  const filter = createRedactionFilter(values);
  const emitted = chunks.map((chunk) => filter.push(chunk));
  return { emitted, text: emitted.join('') + filter.finish() };
}

function everySplit(text: string): string[][] {
  return Array.from({ length: text.length - 1 }, (_, cut) => [
    text.slice(0, cut + 1),
    text.slice(cut + 1),
  ]);
}

const KEY_BLOCK = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

describe('createRedactionFilter', () => {
  it('hides a .env line however the agent splits it into chunks', () => {
    const reply = 'Here it is:\n\nMATHLIB_API_TOKEN=abc123def456ghi\n\nDone.';
    for (const chunks of everySplit(reply)) {
      const { text } = streamed(chunks);
      expect(text).toBe(redactText(reply));
      expect(text).not.toContain('abc123def456ghi');
    }
  });

  it.each([
    ['a token', 'The key is sk-proj-abcdefghijklmnopqrstuvwx for now'],
    ['a bearer header', 'Send Authorization: Bearer abcdef0123456789xyz please'],
    ['a url password', 'Use postgres://spark:hunter2secret@localhost/db here'],
    ['a json field', 'Config: {"apiKey": "live value 0123456789"} ok'],
    ['a private key', `Key:\n${KEY_BLOCK}\nend`],
  ])('hides %s split at any character', (_name, reply) => {
    for (const chunks of everySplit(reply)) {
      expect(streamed(chunks).text).toBe(redactText(reply));
    }
  });

  it('hides literal values from the project secret files', () => {
    const reply = 'The value is s3cr3t-Value-4242 and it is also s3cr3t-Value-4242.';
    for (const chunks of everySplit(reply)) {
      const { text } = streamed(chunks, ['s3cr3t-Value-4242']);
      expect(text).toBe(
        'The value is [redacted:secret_value] and it is also [redacted:secret_value].',
      );
    }
  });

  it('redacts the same way whether a mid-line assignment arrives split or whole', () => {
    const reply = 'Set it like MY_TOKEN=abcdef012345 in the shell.\nAPI_KEY=abcdef012345\n';
    for (const chunks of everySplit(reply)) {
      expect(streamed(chunks).text).toBe(redactText(reply));
    }
  });

  it('streams a line with a colon without waiting for its end', () => {
    const { emitted } = streamed(['Here is what I found: the ', 'tests pass']);
    expect(emitted).toEqual(['Here is what I found: the ', 'tests ']);
  });

  it('keeps streaming ordinary prose word by word', () => {
    const { emitted, text } = streamed(['Hello the', 're, this is ', 'fine text']);
    expect(emitted).toEqual(['Hello ', 'there, this is ', 'fine ']);
    expect(text).toBe('Hello there, this is fine text');
  });

  it('holds a line that could become a secret until it ends', () => {
    const filter = createRedactionFilter([]);
    expect(filter.push('Intro\nAPI_TOKEN=')).toBe('Intro\n');
    expect(filter.push('abcdef')).toBe('');
    expect(filter.push('0123\nnext ')).toBe('API_TOKEN=[redacted:env]\n');
    expect(filter.finish()).toBe('next ');
  });

  it('says how much text it is still holding', () => {
    const filter = createRedactionFilter([]);
    expect(filter.pending()).toBe(0);
    expect(filter.push('Both views check out.')).toBe('Both views check ');
    expect(filter.pending()).toBe(4);
    filter.finish();
    expect(filter.pending()).toBe(0);
  });

  it('flushes held text when the reply ends', () => {
    const filter = createRedactionFilter([]);
    expect(filter.push('A_SECRET=value1234')).toBe('');
    expect(filter.finish()).toBe('A_SECRET=[redacted:env]');
  });
});
