import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { ProviderOutput } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const definition: AgentDefinition = { ...agentDefinitions.claude, ...FAKE_AGENT_MODES };
const SHORT_NOTE = 'Opus 5.5 is using a 200K context window on this account, not 1M';

function ambient(): Record<string, string> {
  const inherited = Object.entries(childEnvironment(process.env));
  return Object.fromEntries(inherited.filter(([name]) => name !== 'ANTHROPIC_BASE_URL'));
}

async function run(env: Record<string, string>) {
  const provider = createAcpProvider({
    definition,
    launch,
    env: { ...ambient(), ...env },
    cancelGraceMs: 2_000,
  });
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt: '#env',
    history: [],
    settings: { method: 'cli', model: 'opus', modelLabel: 'Opus 5.5', effort: null },
    signal: new AbortController().signal,
  })) {
    outputs.push(output);
  }
  const report = JSON.parse(replyText(outputs)) as Record<string, unknown>;
  const usage = outputs.find((output) => output.kind === 'usage');
  const notes = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  return { report, usage, notes };
}

describe('Claude long context against the fake agent', { timeout: 20_000 }, () => {
  it('starts the agent without pointing an alias at a model: the agent resolves its own aliases', async () => {
    const { report, usage, notes } = await run({});
    expect(report).toMatchObject({ opus: null, sonnet: null, haiku: null });
    expect(usage).toMatchObject({ contextSize: 1_000_000 });
    expect(notes).not.toContain(SHORT_NOTE);
  });

  it('leaves an alias the user pointed at a model as they set it', async () => {
    const { report } = await run({ ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5' });
    expect(report).toMatchObject({ opus: null, sonnet: 'claude-sonnet-5-5' });
  });

  it('keeps going on the smaller window with a note when the account has no 1M', async () => {
    const { usage, notes } = await run({ FAKE_ACP_WINDOW: '200000' });
    expect(usage).toMatchObject({ contextSize: 200_000 });
    expect(notes).toContain(SHORT_NOTE);
  });
});
