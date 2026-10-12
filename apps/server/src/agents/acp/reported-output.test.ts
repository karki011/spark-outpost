import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../../providers/provider.ts';
import { PRICE_TABLE, costAt } from '../../usage/prices.ts';
import { agentDefinitions } from './agents.ts';
import { asReported } from './reported-output.ts';

const price = PRICE_TABLE.prices.find((entry) => entry.provider === 'codex')!;
const split = { tokens: 9000, input: 8000, cachedRead: 6000, output: 1000 };

const report = (usage: Record<string, unknown>): ProviderOutput => ({
  kind: 'subagent_report',
  id: 'a',
  report: { usage },
});

describe("a sub-agent's reported usage", () => {
  it('gets a cost from the price table when its model and token split are reported', () => {
    const output = asReported(agentDefinitions.codex, report({ ...split, model: price.model }));
    expect(output).toMatchObject({
      report: {
        usage: { costUsd: costAt(price, { input: 8000, cachedRead: 6000, output: 1000 }) },
      },
    });
  });

  it('gets no cost without a split, a model or a known price', () => {
    const none = (definition: typeof agentDefinitions.codex, usage: Record<string, unknown>) =>
      asReported(definition, report(usage));
    expect(none(agentDefinitions.claude, { tokens: 3400, toolUses: 7 })).toEqual(
      report({ tokens: 3400, toolUses: 7 }),
    );
    expect(none(agentDefinitions.codex, split)).toEqual(report(split));
    expect(none(agentDefinitions.codex, { ...split, model: 'unknown-model' })).toEqual(
      report({ ...split, model: 'unknown-model' }),
    );
  });
});
