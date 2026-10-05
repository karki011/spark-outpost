import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import { probeCapabilities } from '../src/agents/acp/probe.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import {
  ModelRejectedError,
  type AgentSettings,
  type ProviderOutput,
} from '../src/providers/provider.ts';
import { rejectionBody } from './fake-acp-access.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch } from './fake-acp-support.ts';

const definition: AgentDefinition = { ...agentDefinitions.codex, ...FAKE_AGENT_MODES };
const RESTRICTED = [
  ['gpt-6-luna', '6 Luna'],
  ['gpt-6.1-sol', 'GPT-6.1 Sol'],
  ['gpt-6-sol', '6 Sol'],
];
const CHATGPT = {
  authStatus: {
    kind: 'account',
    label: 'ChatGPT Plus',
    account: { email: 'someone@example.com', plan: 'plus' },
  },
};

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...childEnvironment(process.env),
    FAKE_ACP_MODELS: JSON.stringify(RESTRICTED),
    FAKE_ACP_REJECT_MODELS: JSON.stringify(['gpt-6.1-sol']),
    FAKE_ACP_AUTH_STATUS: JSON.stringify(CHATGPT),
    ...extra,
  };
}

async function run(prompt: string, model: string, extra: Record<string, string> = {}) {
  const provider = createAcpProvider({ definition, launch, env: env(extra), cancelGraceMs: 2_000 });
  const settings: AgentSettings = { method: 'cli', model, modelLabel: null, effort: null };
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of provider.run({
      prompt,
      history: [],
      settings,
      signal: new AbortController().signal,
    })) {
      outputs.push(output);
    }
  } catch (caught) {
    error = caught;
  }
  return { outputs, error };
}

describe('model access reported over ACP by a fake agent', { timeout: 20_000 }, () => {
  it('reports the restricted model list and the account kind when probed', async () => {
    const report = await probeCapabilities(definition, { launch, env: env() });
    expect(report.models.map((model) => model.id)).toEqual(RESTRICTED.map(([id]) => id));
    expect(report.access).toEqual({
      reported: true,
      unlisted: [],
      account: { kind: 'account', label: 'ChatGPT Plus', plan: 'plus' },
    });
    expect(JSON.stringify(report)).not.toContain('someone@example.com');
  });

  it('marks a provider that reports no availability', async () => {
    const zai = { ...definition, reportsModelAccess: false };
    const report = await probeCapabilities(zai, { launch, env: env({ FAKE_ACP_AUTH_STATUS: '' }) });
    expect(report.access).toEqual({ reported: false, unlisted: [], account: null });
  });

  it('passes the account on during a run and runs normally on a usable model', async () => {
    const { outputs, error } = await run('Hi', 'gpt-6-sol');
    expect(error).toBeNull();
    expect(outputs).toContainEqual({
      kind: 'account',
      account: { kind: 'account', label: 'ChatGPT Plus', plan: 'plus' },
    });
    const capabilities = outputs.find((output) => output.kind === 'capabilities');
    expect(capabilities).toMatchObject({ report: { access: { reported: true, unlisted: [] } } });
  });

  it('turns the Codex ChatGPT-account rejection into a typed error with the raw body kept', async () => {
    const { outputs, error } = await run('Hi', 'gpt-6.1-sol');
    expect(error).toBeInstanceOf(ModelRejectedError);
    const rejected = error as ModelRejectedError;
    expect(rejected.model).toBe('gpt-6.1-sol');
    expect(rejected.message).not.toContain('invalid_request_error');
    expect(rejected.details).toBe(rejectionBody('gpt-6.1-sol'));
    expect(outputs.some((output) => output.kind === 'text_delta')).toBe(false);
  });

  it('recognises the Claude adapter shape, a JSON-RPC error with errorKind', async () => {
    const { error } = await run('Hi', 'gpt-6.1-sol', { FAKE_ACP_REJECT_STYLE: 'claude' });
    expect(error).toBeInstanceOf(ModelRejectedError);
    expect((error as ModelRejectedError).model).toBe('gpt-6.1-sol');
  });
});
