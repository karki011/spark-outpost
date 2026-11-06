import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import {
  customEndpointLaunchEnvironment,
  storedEndpointSecret,
} from '../src/agents/acp/custom-endpoint.ts';
import { probeCapabilities } from '../src/agents/acp/probe.ts';
import type { ProtocolEntry } from '../src/audit/protocol-entry.ts';
import { ProviderError, type ProviderOutput } from '../src/providers/provider.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { createAuditRecorder } from '../src/workflow/audit-recorder.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const KEY = 'gateway-key-0123456789abcdef.QwErTy';
const ENDPOINT = {
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3-coder:30b',
  fastModel: 'qwen3:4b',
};
const FAKE_MODELS = JSON.stringify([
  ['default', 'Default (recommended)'],
  ['opus', 'qwen3-coder:30b'],
  ['sonnet', 'qwen3-coder:30b'],
  ['haiku', 'qwen3:4b'],
]);
const PARENT_CREDENTIALS = {
  ANTHROPIC_API_KEY: 'sk-ant-api03-parent-should-never-reach-the-agent',
  ANTHROPIC_AUTH_TOKEN: 'parent-auth-token',
  ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  CLAUDE_CODE_OAUTH_TOKEN: 'parent-oauth-token',
  CLAUDE_CONFIG_DIR: '/Users/someone/.claude',
  OPENAI_API_KEY: 'sk-proj-parent',
};

let configDir: string;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'spark-outpost-custom-test-'));
});

afterAll(async () => {
  await rm(configDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const [name, value] of Object.entries(PARENT_CREDENTIALS)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const definition: AgentDefinition = {
  ...agentDefinitions.custom,
  ...FAKE_AGENT_MODES,
  keyEnvironment: async (secret) => ({
    ...(await customEndpointLaunchEnvironment(secret, configDir)),
    FAKE_ACP_MODELS: FAKE_MODELS,
  }),
};

const storedWith = (apiKey: string) =>
  memorySecretStore({ custom: storedEndpointSecret(ENDPOINT, apiKey) });

async function run(prompt: string, secrets = storedWith(KEY)) {
  const provider = createAcpProvider({ definition, launch, secrets, cancelGraceMs: 2_000 });
  const written: ProtocolEntry[] = [];
  const audit = createAuditRecorder({
    write: async (entries) => {
      written.push(...entries);
    },
    batchSize: 5,
    flushMs: 5,
  });
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of provider.run({
      prompt,
      history: [],
      settings: { method: 'api_key', model: 'opus', modelLabel: 'qwen3-coder:30b', effort: 'high' },
      signal: new AbortController().signal,
      audit,
      session: { workdir: join(configDir, 'work'), resume: null, freshReason: null },
    })) {
      outputs.push(output);
    }
  } catch (caught) {
    error = caught;
  }
  await audit.close();
  return { outputs, text: replyText(outputs), error, written };
}

describe('custom endpoint provider against the fake agent', { timeout: 20_000 }, () => {
  it('starts the agent with only the endpoint, its key, its models and the isolated config dir', async () => {
    const { text, error } = await run('#env');
    expect(error).toBeNull();
    const report = JSON.parse(text) as Record<string, unknown>;
    expect(report).toMatchObject({
      baseUrl: 'http://127.0.0.1:11434',
      configDir,
      token: 'set',
      opus: 'qwen3-coder:30b',
      haiku: 'qwen3:4b',
      timeout: '3000000',
    });
    expect(report.tokenLength).toBe(KEY.length);
    const names = report.names as string[];
    for (const name of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']) {
      expect(names).not.toContain(name);
    }
    expect(names.filter((name) => !name.startsWith('ANTHROPIC_DEFAULT_'))).toEqual([
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
      'CLAUDE_CODE_FORK_SUBAGENT',
      'CLAUDE_CONFIG_DIR',
    ]);
  });

  it('sends a placeholder token when the endpoint has no key', async () => {
    const { text, error } = await run('#env', storedWith(''));
    expect(error).toBeNull();
    const report = JSON.parse(text) as Record<string, unknown>;
    expect(report).toMatchObject({ token: 'set', tokenLength: 'spark-outpost-no-key'.length });
  });

  it('never puts the key in run outputs, protocol messages or stderr records', async () => {
    const { outputs, written } = await run('#env');
    expect(JSON.stringify(outputs)).not.toContain(KEY);
    expect(JSON.stringify(written)).not.toContain(KEY);
  });

  it('offers the two model slots and drops the reported Anthropic cost', async () => {
    const { outputs } = await run('#env');
    expect(outputs.find((output) => output.kind === 'capabilities')).toMatchObject({
      report: {
        models: [
          { id: 'opus', label: 'qwen3-coder:30b' },
          { id: 'haiku', label: 'qwen3:4b' },
        ],
      },
    });
    const usage = outputs.filter((output) => output.kind === 'usage');
    expect(usage.every((output) => output.kind === 'usage' && output.costUsd === null)).toBe(true);
  });

  it('fails readably when nothing or something unreadable is stored', async () => {
    const missing = await run('Hi', memorySecretStore());
    expect((missing.error as Error).message).toBe(
      'The custom endpoint has no stored settings. Connect it again in Settings.',
    );
    const unreadable = await run('Hi', memorySecretStore({ custom: 'not json' }));
    expect(unreadable.error).toBeInstanceOf(ProviderError);
    expect((unreadable.error as Error).message).toContain('Connect the custom endpoint again');
    const tampered = await run(
      'Hi',
      memorySecretStore({
        custom: storedEndpointSecret({ ...ENDPOINT, baseUrl: 'http://evil.example.com' }, ''),
      }),
    );
    expect((tampered.error as Error).message).toContain('Connect the custom endpoint again');
  });

  it('probes and offers only the two slots', async () => {
    const report = await probeCapabilities(definition, { launch, secrets: storedWith('') });
    expect(report.models.map((model) => model.id)).toEqual(['opus', 'haiku']);
    expect(await readdir(configDir)).not.toContain('.credentials.json');
  });
});
