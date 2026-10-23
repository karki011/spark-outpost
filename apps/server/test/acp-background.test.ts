import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { AgentSettings, ProviderOutput, SteerRequests } from '../src/providers/provider.ts';
import { WRITE_UP_STEP } from '@spark-outpost/contracts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const claude = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
});
const codexLike = createAcpProvider({
  definition: { ...agentDefinitions.codex, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
});
const writingUp = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
  writeUpMs: 1_500,
});
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

interface Watch {
  onOutput?: (output: ProviderOutput, controller: AbortController) => void;
  steering?: SteerRequests;
  provider?: typeof claude;
}

async function collect(prompt: string, watch: Watch = {}) {
  const controller = new AbortController();
  const outputs: ProviderOutput[] = [];
  for await (const output of (watch.provider ?? claude).run({
    prompt,
    history: [],
    settings,
    signal: controller.signal,
    ...(watch.steering ? { steering: watch.steering } : {}),
  })) {
    outputs.push(output);
    watch.onOutput?.(output, controller);
  }
  return outputs;
}

function backgroundReports(outputs: readonly ProviderOutput[]) {
  return outputs.filter((output) => output.kind === 'background_work');
}

describe(
  'ACP provider when a Claude turn ends with background work running',
  { timeout: 20_000 },
  () => {
    it('keeps the run open and records the agent continuing on its own', async () => {
      const outputs = await collect('#background');

      expect(replyText(outputs)).toBe(
        "Started the schema agent. I'll send the write-up once it reports.\n\nSchema finished: turns live in events.",
      );
      expect(backgroundReports(outputs)).toEqual([
        { kind: 'background_work', agents: 1, tasks: 0, names: ['Schema'] },
        { kind: 'background_work', agents: 0, tasks: 0, names: [] },
      ]);
      const started = outputs.flatMap((output) =>
        output.kind === 'subagent_started' ? [output.id] : [],
      );
      expect(started).toEqual(['bg-1', 'bg-1:generation:2']);
      const tokens = outputs.filter((output) => output.kind === 'tokens').at(-1);
      expect(tokens).toMatchObject({ tokens: { total: 280 } });
      expect(outputs.some((output) => output.kind === 'usage' && output.costUsd === 0.5)).toBe(
        true,
      );
    });

    it('keeps the turn writing up when sub-agents handed back, and records the write-up there', async () => {
      const outputs = await collect('#handback', { provider: writingUp });

      expect(replyText(outputs)).toBe('Waiting for the report. \n\nAll reports are in.');
      expect(outputs).toContainEqual({ kind: 'step_started', name: WRITE_UP_STEP });
      expect(outputs).toContainEqual({ kind: 'step_finished', name: WRITE_UP_STEP });
    });

    it('ends the write-up wait when no cycle follows', async () => {
      const started = Date.now();
      const outputs = await collect('#handbackquiet', { provider: writingUp });

      expect(replyText(outputs)).toBe('Waiting for the report. ');
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
      expect(
        outputs.filter(
          (output) => output.kind === 'step_finished' && output.name === WRITE_UP_STEP,
        ),
      ).toHaveLength(1);
    });

    it('ends at the reply as before for an agent that is not Claude', async () => {
      const outputs = await collect('#background', { provider: codexLike });

      expect(replyText(outputs)).toBe(
        "Started the schema agent. I'll send the write-up once it reports.",
      );
      expect(backgroundReports(outputs)).toEqual([]);
    });

    it('stops the waiting run and its background work on Stop', async () => {
      const outputs = await collect('#backgroundforever', {
        onOutput: (output, controller) => {
          if (output.kind === 'background_work' && output.agents > 0) controller.abort();
        },
      });

      expect(backgroundReports(outputs)).toEqual([
        { kind: 'background_work', agents: 1, tasks: 0, names: ['Schema'] },
      ]);
      expect(replyText(outputs)).toBe(
        "Started the schema agent. I'll send the write-up once it reports.",
      );
    });

    it('sends a message written during the wait to the same session as a new prompt', async () => {
      let send: ((text: string) => Promise<boolean>) | null = null;
      const delivered: boolean[] = [];
      const steering: SteerRequests = {
        attach(sender) {
          send = sender;
          return () => {
            send = null;
          };
        },
      };
      let waits = 0;
      const outputs = await collect('#backgroundforever', {
        steering,
        onOutput: (output, controller) => {
          if (output.kind !== 'background_work' || output.agents === 0) return;
          waits += 1;
          if (waits === 1) void send?.('Any news?').then((ok) => delivered.push(ok));
          else controller.abort();
        },
      });

      expect(delivered).toEqual([true]);
      expect(replyText(outputs)).toContain('prompt=Any news?');
      expect(backgroundReports(outputs).map((output) => output.agents)).toEqual([1, 0, 1]);
    });
  },
);
