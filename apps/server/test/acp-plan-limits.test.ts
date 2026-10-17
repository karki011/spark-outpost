import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { ProviderOutput } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch } from './fake-acp-support.ts';

const definition: AgentDefinition = { ...agentDefinitions.claude, ...FAKE_AGENT_MODES };
const FIVE_HOUR_RESET = new Date(1792212600 * 1000);
const WEEK_RESET = new Date(1792425600 * 1000);

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/claude-rate-limit/${name}.json`, import.meta.url));

async function planOutputs(name: string) {
  const provider = createAcpProvider({
    definition,
    launch,
    env: { ...childEnvironment(process.env), FAKE_ACP_RATE_LIMIT: fixture(name) },
    cancelGraceMs: 2_000,
  });
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt: '#ratelimit',
    history: [],
    settings: { method: 'cli', model: 'opus', modelLabel: 'Opus 5.5', effort: null },
    signal: new AbortController().signal,
  })) {
    outputs.push(output);
  }
  return {
    plans: outputs.filter((output) => output.kind === 'plan_limits'),
    usage: outputs.filter((output) => output.kind === 'usage'),
  };
}

describe('Claude plan limits from recorded adapter payloads', { timeout: 20_000 }, () => {
  it('reads both windows and extra usage from a live Claude Max reading', async () => {
    const { plans, usage } = await planOutputs('live-claude-max');
    expect(usage).toHaveLength(1);
    expect(plans).toEqual([
      {
        kind: 'plan_limits',
        windows: [
          { window: 'five_hour', used: 0.06, resetsAt: FIVE_HOUR_RESET, limited: false },
          { window: 'seven_day', used: 0.46, resetsAt: WEEK_RESET, limited: false },
        ],
        extraUsage: {
          status: 'rejected',
          inUse: false,
          disabledReason: 'out_of_credits',
          resetsAt: null,
        },
      },
    ]);
  });

  it('reads the documented single-window shape', async () => {
    const { plans } = await planOutputs('documented-single-window');
    expect(plans).toEqual([
      {
        kind: 'plan_limits',
        windows: [{ window: 'seven_day', used: 0.82, resetsAt: WEEK_RESET, limited: false }],
        extraUsage: null,
      },
    ]);
  });

  it('keeps a window that ran past its cap and marks the limiting one', async () => {
    const { plans } = await planOutputs('rejected-five-hour');
    expect(plans[0]).toMatchObject({
      windows: [
        { window: 'five_hour', used: 1.02, limited: true },
        { window: 'seven_day', used: 0.71, limited: false },
      ],
      extraUsage: { status: 'rejected', disabledReason: 'org_level_disabled_until' },
    });
  });

  it('reports extra usage in use with its reset', async () => {
    const { plans } = await planOutputs('extra-usage-in-use');
    expect(plans[0]).toMatchObject({
      extraUsage: { status: 'allowed', inUse: true, resetsAt: new Date(1793491200 * 1000) },
    });
  });

  it('drops a payload that does not match and keeps the usage reading', async () => {
    const { plans, usage } = await planOutputs('junk');
    expect(plans).toEqual([]);
    expect(usage).toHaveLength(1);
  });
});
