import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { AgentSettings, ProviderOutput, SteerRequests } from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const claude = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
});
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

type Watch = (output: ProviderOutput, controller: AbortController) => void;

async function collect(prompt: string, watch?: Watch, steering?: SteerRequests) {
  const controller = new AbortController();
  const outputs: ProviderOutput[] = [];
  for await (const output of claude.run({
    prompt,
    history: [],
    settings,
    signal: controller.signal,
    ...(steering ? { steering } : {}),
  })) {
    outputs.push(output);
    watch?.(output, controller);
  }
  return outputs;
}

const waits = (outputs: readonly ProviderOutput[]) =>
  outputs.filter((output) => output.kind === 'background_work');

const sleeping = (output: ProviderOutput) =>
  output.kind === 'background_work' && output.wakesAt !== undefined;

describe('ACP provider when a Claude agent schedules a wakeup', { timeout: 20_000 }, () => {
  it('keeps the turn open while it sleeps and records what it does when it wakes', async () => {
    const started = Date.now();
    const outputs = await collect('#sleep');

    expect(Date.now() - started).toBeGreaterThanOrEqual(800);
    expect(replyText(outputs)).toBe(
      'Sleeping until the build is done.\n\nAwake: the build is green.',
    );
    const [asleep, awake] = waits(outputs);
    expect(asleep).toMatchObject({ agents: 0, tasks: 0, names: [] });
    expect(asleep?.kind === 'background_work' && asleep.wakesAt).toBeGreaterThan(started);
    expect(awake).toEqual({ kind: 'background_work', agents: 0, tasks: 0, names: [] });
    expect(waits(outputs)).toHaveLength(2);
    const spent = outputs.filter((output) => output.kind === 'usage' && output.costUsd !== null);
    expect(spent.length).toBeGreaterThanOrEqual(2);
  });

  it('wakes in the same turn after another background cycle ended long before the wakeup', async () => {
    let deadline: NodeJS.Timeout | null = null;
    const outputs = await collect('#sleepbeside', (_output, controller) => {
      deadline ??= setTimeout(() => controller.abort(), 8_000);
    });
    if (deadline) clearTimeout(deadline);

    expect(replyText(outputs)).toBe(
      'Running the tests and sleeping until the deploy.\n\nTests passed.\n\nAwake: the build is green.',
    );
    expect(waits(outputs).at(-1)).toEqual({
      kind: 'background_work',
      agents: 0,
      tasks: 0,
      names: [],
    });
  });

  it('ends the sleep on Stop', async () => {
    const outputs = await collect('#sleeplong', (output, controller) => {
      if (sleeping(output)) controller.abort();
    });

    expect(waits(outputs).filter(sleeping)).toHaveLength(1);
    expect(replyText(outputs)).toBe('Sleeping until the build is done.');
  });

  it('answers a message sent during the sleep and goes back to sleep', async () => {
    let send: ((text: string) => Promise<boolean | 'later'>) | null = null;
    const steering: SteerRequests = {
      attach(sender) {
        send = sender;
        return () => {
          send = null;
        };
      },
    };
    let sent = false;
    const outputs = await collect(
      '#sleeplong',
      (output, controller) => {
        if (!sleeping(output)) return;
        if (sent) controller.abort();
        else {
          sent = true;
          void send?.('Hi');
        }
      },
      steering,
    );

    expect(replyText(outputs)).toContain('Hi');
    expect(waits(outputs).filter(sleeping)).toHaveLength(2);
  });
});
