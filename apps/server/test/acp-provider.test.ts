import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import { THINKING_STEP } from '../src/agents/acp/session-updates.ts';
import type { ProtocolEntry } from '../src/audit/protocol-entry.ts';
import { createAuditRecorder } from '../src/workflow/audit-recorder.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import {
  ProviderError,
  type AgentSettings,
  type ProviderOutput,
  type TurnAttachment,
} from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const definition: AgentDefinition = {
  ...agentDefinitions.codex,
  name: 'Fake',
  ...FAKE_AGENT_MODES,
};
const provider = createAcpProvider({ definition, launch, cancelGraceMs: 2_000 });
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

async function collect(prompt: string, options: Partial<AgentSettings> = {}, signal?: AbortSignal) {
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of provider.run({
      prompt,
      history: [{ role: 'user', content: 'earlier question' }],
      settings: { ...settings, ...options },
      signal: signal ?? new AbortController().signal,
    })) {
      outputs.push(output);
    }
  } catch (caught) {
    error = caught;
  }
  const text = replyText(outputs);
  return { outputs, text, error };
}

async function inPrivateTmp<T>(work: () => Promise<T>): Promise<{ result: T; left: string[] }> {
  const shared = process.env.TMPDIR;
  const own = mkdtempSync(join(tmpdir(), 'acp-provider-test-'));
  process.env.TMPDIR = own;
  try {
    const result = await work();
    return { result, left: readdirSync(own) };
  } finally {
    if (shared === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = shared;
    rmSync(own, { recursive: true, force: true });
  }
}

describe('ACP provider against a fake agent over stdio', { timeout: 20_000 }, () => {
  it('streams steps and text, forces the safe mode, and applies model and effort', async () => {
    const { result, left } = await inPrivateTmp(() =>
      collect('Hi', { model: 'nope', modelLabel: 'Smart Two', effort: 'high' }),
    );
    const { outputs, text, error } = result;
    expect(error).toBeNull();
    expect(outputs[0]).toMatchObject({
      kind: 'capabilities',
      report: { defaultModel: 'fast-1', efforts: expect.arrayContaining([expect.anything()]) },
    });
    const steps = outputs.filter((output) => output.kind.startsWith('step_'));
    expect(steps.slice(0, 8)).toEqual([
      { kind: 'step_started', name: 'Using Smart Two · high effort' },
      expect.objectContaining({ kind: 'step_finished', name: 'Using Smart Two · high effort' }),
      { kind: 'step_started', name: 'Recalled 1 earlier message' },
      expect.objectContaining({ kind: 'step_finished', name: 'Recalled 1 earlier message' }),
      { kind: 'step_started', name: THINKING_STEP },
      expect.objectContaining({ kind: 'step_finished', name: THINKING_STEP }),
      { kind: 'step_started', name: 'Read context', tool: true, toolKind: 'read' },
      expect.objectContaining({ kind: 'step_finished', name: 'Read context' }),
    ]);
    expect(text).toContain('Hello there\n\nmode=read-only model=smart-2 effort=high');
    expect(text).toContain('User: earlier question');
    expect(outputs).toContainEqual({
      kind: 'tokens',
      tokens: {
        input: 220,
        output: 60,
        total: 180,
        cachedRead: 100,
        cachedWrite: null,
        thought: null,
      },
    });
    expect(left).toEqual([]);
  });

  it('notes settings the agent does not offer instead of failing', async () => {
    const { outputs, error } = await collect('Hi', { model: 'gpt-9', effort: 'max' });
    expect(error).toBeNull();
    const notes = outputs
      .filter((output) => output.kind === 'step_started')
      .map((output) => output.name);
    expect(notes).toContain("Using Fake's default model; gpt-9 isn't offered by the agent");
    expect(notes).toContain("Using Fake's default effort; max isn't offered by the agent");
  });

  it('declares notice, failure, sub-agent and background task support when it initializes', async () => {
    const { text } = await collect('#caps');
    expect(JSON.parse(text.split('\n')[0]!)).toMatchObject({
      session: { notices: {} },
      _meta: {
        jetbrains: {
          air: {
            version: 1,
            capabilities: ['sessionFailure', 'nativeSubagentSessions', 'asyncTasks'],
          },
        },
      },
    });
  });

  it('declines permission requests in a conversation and records a step', async () => {
    const { outputs, text } = await collect('#write');
    expect(text).toBe('permission=no');
    expect(outputs).toContainEqual({
      kind: 'step_started',
      name: 'Declined: Write notes.txt (this chat has no project folder)',
      tool: true,
    });
  });

  it('cancels a streaming turn when the signal aborts', async () => {
    const controller = new AbortController();
    const outputs: ProviderOutput[] = [];
    for await (const output of provider.run({
      prompt: '#slow',
      history: [],
      settings,
      signal: controller.signal,
    })) {
      outputs.push(output);
      if (outputs.length === 3) controller.abort();
    }
    expect(outputs.length).toBeGreaterThanOrEqual(3);
    expect(outputs.length).toBeLessThan(500);
  });

  it('stops an agent that keeps streaming after the cancel once the grace period ends', async () => {
    const controller = new AbortController();
    let count = 0;
    let abortedAt = 0;
    for await (const output of provider.run({
      prompt: '#stubborn',
      history: [],
      settings,
      signal: controller.signal,
    })) {
      if (output.kind === 'text_delta') count += 1;
      if (count === 3 && abortedAt === 0) {
        abortedAt = Date.now();
        controller.abort();
      }
    }
    expect(Date.now() - abortedAt).toBeLessThan(4_000);
  }, 15_000);

  it.each([
    ['#crash', 'Fake stopped unexpectedly (exit code 3). Try again.'],
    ['#auth', "Fake isn't signed in. Open Settings, reconnect Fake, and try again."],
    [
      '#failure',
      "Fake couldn't sign in (unexpected status 401 Unauthorized). Open Settings, reconnect Fake, and try again.",
    ],
    [
      '#silent',
      "Fake finished without a reply. It may not be able to reach its model, so check that it's signed in and try again.",
    ],
    ['#refuse', 'Fake declined to answer this request.'],
    [
      '#signedout',
      "Fake couldn't sign in (Sign in to continue using Claude.). Open Settings, reconnect Fake, and try again.",
    ],
    [
      '#signedoutquiet',
      "Fake isn't signed in any more. Open Settings, reconnect Fake, and try again.",
    ],
  ])('turns the agent failure %s into a readable provider error', async (prompt, message) => {
    const { error } = await collect(prompt);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(message);
  });

  it('checks the sign-in once when the agent exits without saying why', async () => {
    const exits = async (signedIn?: () => Promise<boolean | null>) => {
      const checked = createAcpProvider({
        definition,
        launch,
        cancelGraceMs: 2_000,
        ...(signedIn ? { signedIn } : {}),
      });
      const run = checked.run({
        prompt: '#crash',
        history: [],
        settings,
        signal: new AbortController().signal,
      });
      try {
        for await (const output of run) void output;
      } catch (error) {
        return (error as Error).message;
      }
      return null;
    };
    let checks = 0;
    const signedOut = async () => {
      checks += 1;
      return false;
    };
    expect(await exits(signedOut)).toBe(
      "Fake isn't signed in any more. Open Settings, reconnect Fake, and try again.",
    );
    expect(checks).toBe(1);
    const crashed = 'Fake stopped unexpectedly (exit code 3). Try again.';
    expect(await exits()).toBe(crashed);
    expect(await exits(async () => true)).toBe(crashed);
    expect(await exits(async () => null)).toBe(crashed);
    expect(
      await exits(async () => {
        throw new Error('no CLI');
      }),
    ).toBe(crashed);
  });

  it('warns while the agent reconnects to its model before failing', async () => {
    const { outputs } = await collect('#failure');
    expect(outputs).toContainEqual({
      kind: 'step_started',
      name: 'Warning: Reconnecting to the model',
    });
  });

  it('refuses API key connections before starting an agent', async () => {
    const { error } = await collect('Hi', { method: 'api_key' });
    expect(error).toBeInstanceOf(ProviderError);
  });

  it('switches agents that only report legacy modes with set_mode', async () => {
    const legacy = createAcpProvider({
      definition,
      launch,
      env: { ...childEnvironment(process.env), FAKE_ACP_LEGACY: '1' },
    });
    const outputs: ProviderOutput[] = [];
    for await (const output of legacy.run({
      prompt: 'Hi',
      history: [],
      settings: { ...settings, model: 'smart-2', modelLabel: 'Smart Two' },
      signal: new AbortController().signal,
    })) {
      outputs.push(output);
    }
    const text = outputs.map((output) => (output.kind === 'text_delta' ? output.delta : ''));
    expect(text.join('')).toContain('mode=read-only model=fast-1');
    expect(outputs).toContainEqual({
      kind: 'step_started',
      name: "Using Fake's default model; Smart Two can't be selected with this agent",
    });
  });

  describe('attachments', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    const image: TurnAttachment = {
      name: 'shot.png',
      mediaType: 'image/png',
      kind: 'image',
      data: png,
    };
    const notes: TurnAttachment = {
      name: 'notes.md',
      mediaType: 'text/markdown',
      kind: 'text',
      data: Buffer.from('# Notes'),
    };

    const withCapabilities = (capabilities: object) =>
      createAcpProvider({
        definition,
        launch,
        env: {
          ...childEnvironment(process.env),
          FAKE_ACP_PROMPT_CAPABILITIES: JSON.stringify(capabilities),
        },
      });

    async function blocks(capabilities: object, attachments: TurnAttachment[]) {
      const outputs: ProviderOutput[] = [];
      for await (const output of withCapabilities(capabilities).run({
        prompt: '#blocks',
        attachments,
        history: [],
        settings,
        signal: new AbortController().signal,
      })) {
        outputs.push(output);
      }
      const text = outputs.map((output) => (output.kind === 'text_delta' ? output.delta : ''));
      return JSON.parse(text.join('')) as string[];
    }

    it('sends images and embedded text resources when the agent supports them', async () => {
      expect(await blocks({ image: true, embeddedContext: true }, [image, notes])).toEqual([
        'text',
        `image:image/png:${png.toString('base64').length}`,
        'resource:attachment:///notes.md',
      ]);
    });

    it('inlines text files when the agent lacks embedded context', async () => {
      expect(await blocks({}, [notes])).toEqual(['text']);
    });

    it('refuses images when the agent cannot read them', async () => {
      const outputs = withCapabilities({}).run({
        prompt: 'Look',
        attachments: [image],
        history: [],
        settings,
        signal: new AbortController().signal,
      });
      await expect(outputs[Symbol.asyncIterator]().next()).rejects.toThrow(
        "Fake can't read images. Remove the image and try again.",
      );
    });
  });
});

const SECRETS = [
  'sk-proj-abcdefghijklmnopqrstuvwx',
  'ghp_abcdefghijklmnopqrstuvwxyz0123',
  'hello-from-dotenv',
  'abc123def456ghi789',
];

async function recordTurn(prompt: string, stopWhen?: (output: ProviderOutput) => boolean) {
  const controller = new AbortController();
  const written: ProtocolEntry[] = [];
  const audit = createAuditRecorder({
    write: async (entries) => {
      written.push(...entries);
    },
    batchSize: 3,
    flushMs: 5,
  });
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt,
    history: [],
    settings: { ...settings, model: 'smart-2', effort: 'high' },
    signal: controller.signal,
    audit,
  })) {
    outputs.push(output);
    if (stopWhen?.(output)) controller.abort();
  }
  await audit.close();
  return { written, outputs, toolCalls: audit.toolCallCount() };
}

const protocolOnly = (entries: ProtocolEntry[]) =>
  entries.filter((entry) => entry.kind !== 'stderr');

describe('ACP protocol audit against the fake agent', { timeout: 20_000 }, () => {
  it('records every message in order, in both directions, with replies matched to methods', async () => {
    const { written, outputs } = await recordTurn('Hi');
    const entries = protocolOnly(written);
    const calls = entries.map((entry) => `${entry.direction} ${entry.kind} ${entry.method}`);
    expect(calls.slice(0, 4)).toEqual([
      'to_agent request initialize',
      'from_agent response initialize',
      'to_agent request session/new',
      'from_agent response session/new',
    ]);
    expect(calls).toContain('to_agent request session/set_config_option');
    expect(calls).toContain('from_agent notification session/update');
    const prompt = calls.indexOf('to_agent request session/prompt');
    expect(prompt).toBeGreaterThan(
      calls.lastIndexOf('from_agent response session/set_config_option'),
    );
    expect(calls.indexOf('from_agent notification session/update')).toBeGreaterThan(prompt);
    expect(calls.at(-1)).toBe('from_agent response session/prompt');
    expect(calls.filter((call) => call.includes('session/update'))).toHaveLength(7);
    const times = entries.map((entry) => entry.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const entry of entries) {
      expect(entry.sizeBytes).toBeGreaterThan(0);
      expect(entry.truncated).toBe(false);
      if (entry.kind !== 'notification') expect(entry.rpcId).not.toBeNull();
    }
    expect(outputs).toContainEqual({
      kind: 'session_settings',
      model: 'smart-2',
      effort: 'high',
      mode: 'read-only',
      options: {},
    });
  });

  it('redacts secrets in tool output, secret files, and stderr before they are stored', async () => {
    const { written, toolCalls } = await recordTurn('#secret');
    const stored = JSON.stringify(written.map((entry) => entry.payload));
    for (const secret of SECRETS) expect(stored).not.toContain(secret);
    expect(stored).toContain('OPENAI_API_KEY=[redacted:env]');
    expect(stored).toContain('token [redacted:github_token]');
    expect(stored).toContain('HOME=/home/x');
    const envRead = written.find(
      (entry) =>
        JSON.stringify(entry.payload).includes('"toolCallId":"s2"') &&
        JSON.stringify(entry.payload).includes('"status":"completed"'),
    );
    expect(JSON.stringify(envRead?.payload)).toContain('"rawOutput":"[redacted:secret_file]"');
    const stderr = written.filter((entry) => entry.kind === 'stderr');
    expect(stderr.map((entry) => entry.payload)).toContainEqual({
      text: 'auth header Bearer [redacted:bearer]\n',
    });
    expect(toolCalls).toBe(2);
  });

  it('keeps recording after Stop, including the cancel notification and cancelled reply', async () => {
    const { written } = await recordTurn('#slow', (output) => output.kind === 'text_delta');
    const calls = protocolOnly(written).map((entry) => `${entry.direction} ${entry.method}`);
    expect(calls).toContain('to_agent session/cancel');
    expect(calls.at(-1)).toBe('from_agent session/prompt');
    const last = protocolOnly(written).at(-1)!;
    expect(last.payload).toMatchObject({ result: { stopReason: 'cancelled' } });
  });
});
