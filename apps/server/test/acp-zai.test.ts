import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import { probeCapabilities } from '../src/agents/acp/probe.ts';
import { zaiLaunchEnvironment } from '../src/agents/acp/zai.ts';
import type { ProtocolEntry } from '../src/audit/protocol-entry.ts';
import {
  ProviderError,
  type PermissionGate,
  type ProviderOutput,
} from '../src/providers/provider.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { createAuditRecorder } from '../src/workflow/audit-recorder.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const KEY = 'zai-test-key-0123456789abcdef.QwErTyUiOp';
const FAKE_MODELS = JSON.stringify([
  ['default', 'Default (recommended)'],
  ['opus', 'GLM-5.3'],
  ['claude-fable-5-1', 'Fable 5.1'],
  ['sonnet', 'GLM-5.3'],
  ['haiku', 'GLM-5.3-Flash'],
]);
const PARENT_CREDENTIALS = {
  ANTHROPIC_API_KEY: 'sk-ant-api03-parent-should-never-reach-the-agent',
  ANTHROPIC_AUTH_TOKEN: 'parent-auth-token',
  ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  CLAUDE_CODE_OAUTH_TOKEN: 'parent-oauth-token',
  CLAUDE_CONFIG_DIR: '/Users/someone/.claude',
  CLAUDE_SECURESTORAGE_CONFIG_DIR: '/Users/someone/.claude',
  AWS_BEARER_TOKEN_BEDROCK: 'parent-bedrock-token',
  OPENAI_API_KEY: 'sk-proj-parent',
};

let configDir: string;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'spark-outpost-zai-test-'));
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
  ...agentDefinitions.zai,
  ...FAKE_AGENT_MODES,
  keyEnvironment: async (apiKey) => ({
    ...(await zaiLaunchEnvironment(apiKey, configDir)),
    FAKE_ACP_MODELS: FAKE_MODELS,
  }),
};

async function run(prompt: string, secrets = memorySecretStore({ zai: KEY })) {
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
      settings: { method: 'api_key', model: 'haiku', modelLabel: 'GLM-5.3-Flash', effort: 'high' },
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
  const text = replyText(outputs);
  return { outputs, text, error, written };
}

describe('Z.ai provider against the fake agent', { timeout: 20_000 }, () => {
  it('starts the agent with only the Z.ai key, the Z.ai URL and the isolated config dir', async () => {
    const { text, error } = await run('#env');
    expect(error).toBeNull();
    const report = JSON.parse(text) as Record<string, unknown>;
    expect(report).toMatchObject({
      baseUrl: 'https://api.z.ai/api/anthropic',
      configDir,
      token: 'set',
      opus: 'glm-5.3[1m]',
      haiku: 'glm-5.3-flash[1m]',
      timeout: '3000000',
    });
    expect(report.tokenLength).toBe(KEY.length);
    const names = report.names as string[];
    for (const name of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']) {
      expect(names).not.toContain(name);
    }
    expect(names).not.toContain('AWS_BEARER_TOKEN_BEDROCK');
    expect(names).not.toContain('CLAUDE_SECURESTORAGE_CONFIG_DIR');
    expect(names.filter((name) => !name.startsWith('ANTHROPIC_DEFAULT_'))).toEqual([
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
      'CLAUDE_CONFIG_DIR',
    ]);
  });

  it('never puts the key in run outputs, protocol messages or stderr records', async () => {
    const { outputs, written } = await run('#env');
    expect(written.some((entry) => entry.kind === 'stderr')).toBe(true);
    expect(JSON.stringify(outputs)).not.toContain(KEY);
    expect(JSON.stringify(written)).not.toContain(KEY);
  });

  it('shows only the GLM models and efforts, records the GLM model id and drops the reported cost', async () => {
    const { outputs } = await run('#env');
    const report = outputs.find((output) => output.kind === 'capabilities');
    expect(report).toMatchObject({
      report: {
        models: [
          { id: 'opus', label: 'GLM-5.3' },
          { id: 'haiku', label: 'GLM-5.3-Flash' },
        ],
      },
    });
    expect(outputs).toContainEqual(
      expect.objectContaining({ kind: 'session_settings', model: 'glm-5.3-flash' }),
    );
    const usage = outputs.filter((output) => output.kind === 'usage');
    expect(usage).toEqual([
      {
        kind: 'usage',
        contextUsed: 1_000,
        contextSize: 1_000_000,
        costUsd: null,
        readings: 'start_and_end',
      },
    ]);
  });

  it('fails with a readable message when no key is stored, without starting the agent', async () => {
    const { error } = await run('Hi', memorySecretStore());
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      'Z.ai (GLM) has no stored API key. Paste the key again in Settings.',
    );
  });

  it('keeps refusing key connections for agents without a key environment', async () => {
    const claude = createAcpProvider({ definition: agentDefinitions.claude, launch });
    const turn = claude.run({
      prompt: 'Hi',
      history: [],
      settings: { method: 'api_key', model: null, modelLabel: null, effort: null },
      signal: new AbortController().signal,
    });
    await expect(turn[Symbol.asyncIterator]().next()).rejects.toThrow(/API key aren't supported/);
  });

  it('probes with the key and offers only the GLM models', async () => {
    const report = await probeCapabilities(definition, {
      launch,
      secrets: memorySecretStore({ zai: KEY }),
    });
    expect(report.models.map((model) => model.id)).toEqual(['opus', 'haiku']);
    expect(report.defaultModel).toBe('opus');
    expect(await readdir(configDir)).not.toContain('.credentials.json');
  });
});

describe('Z.ai in the fake runtime', { timeout: 20_000 }, () => {
  const agentScript = join(import.meta.dirname, 'fake-acp-agent.ts');
  const allow: PermissionGate = {
    review: async (request) => ({
      outcome: 'selected',
      optionId: request.options.find((option) => option.kind === 'allow_once')!.optionId,
      allowed: true,
      note: 'Allowed',
    }),
  };

  async function build(secrets = memorySecretStore({ zai: KEY })) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'spark-outpost-zai-build-')));
    await writeFile(join(root, 'notes.txt'), 'before\n');
    const zai = createProviders('fake', agentScript, secrets).get('zai')!;
    const outputs: ProviderOutput[] = [];
    let error: unknown = null;
    try {
      for await (const output of zai.run({
        prompt: '#build Update the notes',
        history: [],
        settings: { method: 'api_key', model: 'haiku', modelLabel: 'GLM-5.3-Flash', effort: 'low' },
        projectRoots: [root],
        mode: 'do',
        approvals: allow,
        signal: new AbortController().signal,
      })) {
        outputs.push(output);
      }
    } catch (caught) {
      error = caught;
    }
    const notes = await readFile(join(root, 'notes.txt'), 'utf8');
    await rm(root, { recursive: true, force: true });
    const text = replyText(outputs);
    return { outputs, text, error, notes };
  }

  it('runs a fake GLM Builder turn when a key is stored, without handing the key to the agent', async () => {
    const { outputs, text, error, notes } = await build();
    expect(error).toBeNull();
    expect(text).toContain('Built it after 0 earlier prompts.');
    expect(notes).toBe('before\nstep 1\n');
    expect(outputs).toContainEqual(
      expect.objectContaining({ kind: 'session_settings', model: 'glm-5.3-flash' }),
    );
    expect(JSON.stringify(outputs)).not.toContain(KEY);
  });

  it('still needs a stored key', async () => {
    const { error, notes } = await build(memorySecretStore());
    expect((error as Error).message).toMatch(/has no stored API key/);
    expect(notes).toBe('before\n');
  });
});
