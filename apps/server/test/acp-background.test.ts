import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type {
  AgentSettings,
  ProviderMessage,
  ProviderOutput,
  SteerOutcome,
  SteerRequests,
} from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { WRITE_UP_STEP } from '@spark-outpost/contracts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const claude = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  env: {
    ...childEnvironment(process.env),
    FAKE_ACP_PROMPT_CAPABILITIES: JSON.stringify({ image: true }),
  },
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
  inbox?: { take(): Promise<ProviderMessage | null> };
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
    ...(watch.inbox ? { inbox: watch.inbox } : {}),
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

    describe('a message sent while the agent runs its own follow-up after the prompt ended', () => {
      function steeringInto(sent: SteerOutcome[]) {
        let send: ((text: ProviderMessage) => Promise<SteerOutcome>) | null = null;
        const steering: SteerRequests = {
          attach(sender) {
            send = sender;
            return () => {
              send = null;
            };
          },
        };
        const offer = async (text: string) => {
          const outcome = (await send?.(text)) ?? false;
          sent.push(outcome);
          return outcome;
        };
        return { steering, offer };
      }

      it('holds the message until the follow-up ends and keeps the follow-up reply', async () => {
        const sent: SteerOutcome[] = [];
        const { steering, offer } = steeringInto(sent);
        const outputs = await collect('#ownfollowup', {
          steering,
          onOutput: (output) => {
            if (output.kind !== 'tool_started') return;
            void delay(30).then(() => offer('Any news?'));
          },
        });
        expect(sent).toEqual(['later']);
        expect(replyText(outputs)).toBe('Started. \n\nFIRST-DONE.');
      });

      it('finishes on its own when nothing is sent', async () => {
        const outputs = await collect('#ownfollowup');
        expect(replyText(outputs)).toBe('Started. \n\nFIRST-DONE.');
      });

      it('stops while the message is held, and the message never reaches the agent', async () => {
        const sent: SteerOutcome[] = [];
        const { steering, offer } = steeringInto(sent);
        const outputs = await collect('#ownfollowup', {
          steering,
          onOutput: (output, controller) => {
            if (output.kind !== 'tool_started') return;
            void delay(30)
              .then(() => offer('Any news?'))
              .then(() => controller.abort());
          },
        });
        expect(sent).toEqual(['later']);
        expect(replyText(outputs)).not.toContain('Any news?');
      });

      it('keeps a message held while the end of the follow-up checks the queue', async () => {
        const sent: SteerOutcome[] = [];
        const { steering, offer } = steeringInto(sent);
        let claims = 0;
        const outputs = await collect('#ownfollowup', {
          steering,
          inbox: {
            take: async () => {
              claims += 1;
              if (claims === 2) await offer('Any news?');
              return null;
            },
          },
        });
        expect(sent).toEqual(['later']);
        expect(replyText(outputs)).not.toContain('Any news?');
      });

      it('sends a message claimed from the inbox at the end of the follow-up', async () => {
        const waiting = ['Queued while it ran'];
        let claims = 0;
        const outputs: ProviderOutput[] = [];
        for await (const output of claude.run({
          prompt: '#ownfollowup',
          history: [],
          settings,
          signal: new AbortController().signal,
          inbox: {
            take: async () => {
              claims += 1;
              return claims === 1 ? null : (waiting.shift() ?? null);
            },
          },
        })) {
          outputs.push(output);
        }
        expect(replyText(outputs)).toContain('prompt=Queued while it ran');
      });
    });

    it.each([false, true])(
      'sends a message during background work with attachments=%s',
      async (rich) => {
        let send: ((text: ProviderMessage) => Promise<boolean | 'later'>) | null = null;
        const delivered: SteerOutcome[] = [];
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
            if (waits === 1)
              void send?.(
                rich
                  ? {
                      text: '#blocks',
                      attachments: [
                        {
                          name: 'screen.png',
                          mediaType: 'image/png',
                          kind: 'image',
                          data: Buffer.from('pixels'),
                        },
                      ],
                    }
                  : 'Any news?',
              ).then((ok) => delivered.push(ok));
            else controller.abort();
          },
        });

        expect(delivered).toEqual([true]);
        if (!rich) expect(replyText(outputs)).toContain('prompt=Any news?');
        if (rich) expect(replyText(outputs)).toContain('image:image/png:8');
        expect(backgroundReports(outputs).map((output) => output.agents)).toEqual([1, 0, 1]);
      },
    );
  },
);
