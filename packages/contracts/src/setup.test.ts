import { describe, expect, it } from 'vitest';
import { apiKeyHint, maskApiKey } from './setup.ts';

const claude = { id: 'claude' as const, name: 'Claude', keyPrefix: 'sk-ant-', keyHint: 'Find it.' };
const codex = { id: 'codex' as const, name: 'Codex', keyPrefix: 'sk-', keyHint: 'Find it.' };
const jev = { id: 'jev' as const, name: 'Jev', keyPrefix: '', keyHint: 'Find it.' };

describe('apiKeyHint', () => {
  it('shows the neutral hint for an empty key', () => {
    expect(apiKeyHint(claude, '  ')).toEqual({
      tone: 'neutral',
      message: 'Find it.',
      valid: false,
    });
  });

  it('rejects the wrong prefix', () => {
    expect(apiKeyHint(claude, 'sk-proj-abc').message).toBe('Claude keys start with sk-ant-');
  });

  it('catches an Anthropic key pasted under Codex', () => {
    expect(apiKeyHint(codex, 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxx').message).toContain(
      'Anthropic key',
    );
  });

  it('rejects short keys and accepts well-formed ones', () => {
    expect(apiKeyHint(claude, 'sk-ant-short').message).toContain('too short');
    expect(apiKeyHint(claude, `sk-ant-${'a'.repeat(30)}`)).toMatchObject({
      tone: 'good',
      valid: true,
    });
  });
});

describe('apiKeyHint without a documented key format', () => {
  it('leaves the format check to the provider', () => {
    expect(apiKeyHint(jev, '  ').valid).toBe(false);
    expect(apiKeyHint(jev, 'any-format-key')).toMatchObject({ tone: 'good', valid: true });
  });
});

describe('maskApiKey', () => {
  it('keeps only the first seven and last four characters', () => {
    expect(maskApiKey('sk-ant-api03-abcdefghijklmnop4f2a')).toBe('sk-ant-…4f2a');
  });

  it('can hide the whole start of a key', () => {
    expect(maskApiKey('abcdefghijklmnop4f2a', 0)).toBe('…4f2a');
  });
});
