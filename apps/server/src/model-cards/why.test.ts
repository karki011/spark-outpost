import { describe, expect, it } from 'vitest';
import { whyLine } from './why.ts';

const pick = (provider: string, model: string | null, modelLabel: string | null = null) => ({
  provider,
  model,
  modelLabel,
  effort: null,
});

describe('whyLine', () => {
  it('names the Jev pick when only the provider differs', () => {
    const line = whyLine({
      pick: pick('claude', null),
      routedBy: 'rules',
      rule: 'chat model',
      autoWouldUse: pick('codex', null),
    });
    expect(line).toBe(
      'Why the agent default: rule chat model · Jev would have used the agent default (codex)',
    );
  });

  it('stays quiet when Jev agrees', () => {
    const line = whyLine({
      pick: pick('claude', 'claude-sonnet-5', 'Sonnet 5'),
      routedBy: 'rules',
      rule: 'chat model',
      autoWouldUse: pick('claude', 'claude-sonnet-5', 'Sonnet 5'),
    });
    expect(line).not.toContain('Jev');
  });
});
