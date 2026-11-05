import { describe, expect, it } from 'vitest';
import {
  customEndpointProblem,
  customEndpointSchema,
  customEndpointUrl,
} from './custom-endpoint.ts';
import { verifyRequestSchema } from './setup.ts';

const baseUrlOf = (raw: string) => {
  const result = customEndpointUrl(raw);
  return result.ok ? result.baseUrl : null;
};

const problemOf = (raw: string) => {
  const result = customEndpointUrl(raw);
  return result.ok ? null : result.problem;
};

describe('custom endpoint address', () => {
  it('takes https anywhere and keeps a base path without its trailing slash', () => {
    expect(baseUrlOf('https://gateway.example.com')).toBe('https://gateway.example.com');
    expect(baseUrlOf(' https://gateway.example.com/anthropic/ ')).toBe(
      'https://gateway.example.com/anthropic',
    );
    expect(baseUrlOf('https://10.0.0.5:8443')).toBe('https://10.0.0.5:8443');
  });

  it('takes http only on this computer', () => {
    expect(baseUrlOf('http://localhost:11434')).toBe('http://localhost:11434');
    expect(baseUrlOf('http://127.0.0.1:1234/')).toBe('http://127.0.0.1:1234');
    expect(baseUrlOf('http://[::1]:8080')).toBe('http://[::1]:8080');
    expect(baseUrlOf('http://LOCALHOST:4000')).toBe('http://localhost:4000');
    for (const raw of [
      'http://192.168.1.20:11434',
      'http://my-box.local:11434',
      'http://localhost.example.com',
      'http://127.0.0.2:11434',
    ]) {
      expect(problemOf(raw)).toContain('http:// works only for localhost');
    }
  });

  it('refuses other schemes, logins, queries and fragments', () => {
    expect(problemOf('ftp://localhost')).toContain('https:// or http://');
    expect(problemOf('localhost:11434')).toContain('https:// or http://');
    expect(problemOf('not an address')).toContain('https:// or http://');
    expect(problemOf('https://user:secret@gateway.example.com')).toContain('Leave the login out');
    expect(problemOf('https://token@gateway.example.com')).toContain('Leave the login out');
    expect(problemOf('https://gateway.example.com/?key=abc')).toContain('after ? or #');
    expect(problemOf('https://gateway.example.com/#x')).toContain('after ? or #');
    expect(problemOf('https://gateway.example.com/#')).toContain('after ? or #');
    expect(problemOf('')).toContain('Type the server address');
    expect(problemOf(`https://example.com/${'a'.repeat(2100)}`)).toContain('too long');
  });

  it('points out a pasted /v1 or /v1/messages, which Spark adds itself', () => {
    expect(problemOf('http://localhost:11434/v1')).toContain('Leave out /v1');
    expect(problemOf('https://gateway.example.com/anthropic/v1/messages/')).toContain(
      'Leave out /v1',
    );
    expect(baseUrlOf('https://gateway.example.com/v1beta')).toBe(
      'https://gateway.example.com/v1beta',
    );
  });
});

describe('custom endpoint settings', () => {
  it('needs a model name without spaces and allows an empty fast model', () => {
    const parsed = customEndpointSchema.parse({
      baseUrl: 'http://localhost:11434/',
      model: ' hf.co/org/model:Q4_K_M ',
      fastModel: '',
    });
    expect(parsed).toEqual({
      baseUrl: 'http://localhost:11434',
      model: 'hf.co/org/model:Q4_K_M',
      fastModel: '',
    });
    const fields = { baseUrl: 'http://localhost:11434', model: 'qwen3', fastModel: '' };
    expect(customEndpointProblem(fields)).toBeNull();
    expect(customEndpointProblem({ ...fields, model: '' })).toContain('Type the model name');
    expect(customEndpointProblem({ ...fields, model: 'two words' })).toContain('no spaces');
    expect(customEndpointProblem({ ...fields, fastModel: 'bad\nname' })).toContain('no spaces');
    expect(customEndpointProblem({ ...fields, model: 'x'.repeat(201) })).not.toBeNull();
    expect(customEndpointProblem({ ...fields, baseUrl: 'http://10.0.0.2' })).toContain('localhost');
  });

  it('is a verify request of its own with an optional key', () => {
    const endpoint = { baseUrl: 'http://localhost:11434', model: 'qwen3', fastModel: '' };
    expect(verifyRequestSchema.parse({ method: 'endpoint', endpoint, apiKey: '' })).toEqual({
      method: 'endpoint',
      endpoint,
      apiKey: '',
    });
    expect(verifyRequestSchema.safeParse({ method: 'api_key', apiKey: '' }).success).toBe(false);
    expect(
      verifyRequestSchema.safeParse({
        method: 'endpoint',
        endpoint: { ...endpoint, baseUrl: 'http://example.com' },
        apiKey: '',
      }).success,
    ).toBe(false);
  });
});
