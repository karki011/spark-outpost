import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../../providers/provider.ts';
import { agentDefinitions } from './agents.ts';
import { usageOutputs } from './plan-limits.ts';
import { asReported } from './reported-output.ts';

const opus = { '_claude/model': 'claude-opus-5-5' };

function reported(provider: keyof typeof agentDefinitions, outputs: ProviderOutput[]) {
  return outputs.map((output) => asReported(agentDefinitions[provider], output));
}

describe('usage readings as reported', () => {
  it("marks Claude's mid-turn window as provisional and its result window as reported", () => {
    const during = usageOutputs({
      sessionUpdate: 'usage_update',
      used: 134_000,
      size: 200_000,
      _meta: opus,
    });
    const after = usageOutputs({
      sessionUpdate: 'usage_update',
      used: 134_000,
      size: 1_000_000,
      cost: { amount: 0.81, currency: 'USD' },
      _meta: opus,
    });
    expect(reported('claude', during)).toEqual([
      expect.objectContaining({ model: 'claude-opus-5-5', provisionalWindow: true }),
    ]);
    expect(reported('claude', after)[0]).not.toHaveProperty('provisionalWindow');
  });

  it("takes Z.ai's result window as reported, then drops its cost for an estimate", () => {
    const after = usageOutputs({
      sessionUpdate: 'usage_update',
      used: 1_000,
      size: 1_000_000,
      cost: { amount: 0.1, currency: 'USD' },
    });
    expect(reported('zai', after)).toEqual([
      expect.not.objectContaining({ provisionalWindow: true }),
    ]);
    expect(reported('zai', after)[0]).toMatchObject({ costUsd: null });
  });

  it("takes Codex's window as reported, since Codex sends its model's window", () => {
    const codex = usageOutputs({ sessionUpdate: 'usage_update', used: 52_000, size: 258_400 });
    expect(reported('codex', codex)[0]).not.toHaveProperty('provisionalWindow');
  });
});
