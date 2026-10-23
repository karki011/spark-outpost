import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { PermissionGate, ProviderOutput } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { ENGINEERING } from '../src/workflow/chat-prompt-text.ts';
import { startFakeAnthropicApi } from './fake-anthropic-api.ts';

const base = mkdtempSync(join(tmpdir(), 'claude-tool-names-'));
const repo = join(base, 'repo');

const gate: PermissionGate = {
  review: async (request) => {
    const option = request.options.find((candidate) => candidate.kind === 'allow_once')!;
    return { outcome: 'selected', optionId: option.optionId, allowed: true, note: 'allowed' };
  },
};

let api: Awaited<ReturnType<typeof startFakeAnthropicApi>>;
let provider: ReturnType<typeof createAcpProvider>;

beforeAll(async () => {
  mkdirSync(repo);
  writeFileSync(join(repo, 'cart.js'), 'export const total = () => 0;\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  api = await startFakeAnthropicApi();
  const config = join(base, 'claude-config');
  mkdirSync(config);
  provider = createAcpProvider({
    definition: agentDefinitions.claude,
    cancelGraceMs: 2_000,
    env: {
      ...childEnvironment(process.env),
      ANTHROPIC_BASE_URL: api.url,
      ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key',
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  });
});

afterAll(async () => {
  await api?.close();
  rmSync(base, { recursive: true, force: true });
});

async function steps(): Promise<ProviderOutput[]> {
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    mode: 'do',
    changesProject: true,
    prompt: 'Look at cart.js.',
    history: [],
    settings: {
      method: 'cli',
      model: 'opus',
      modelLabel: 'Opus',
      effort: null,
      mode: 'acceptEdits',
    },
    projectRoots: [repo],
    signal: new AbortController().signal,
    approvals: gate,
    spark: { displayName: 'Alex', personality: 'friendly', chatPrompt: ENGINEERING },
    session: { workdir: join(base, 'work'), resume: null, freshReason: null },
  })) {
    if (output.kind === 'step_started' || output.kind === 'step_finished') outputs.push(output);
  }
  return outputs;
}

describe('ACP tool names from claude-agent-acp 0.81.2', () => {
  it('names each step with the Claude tool it ran, on start and finish', async () => {
    api.useTool({ name: 'Read', input: { file_path: join(repo, 'cart.js') } });
    api.useTool({ name: 'Grep', input: { pattern: 'total', path: repo } });
    api.useTool({ name: 'Glob', input: { pattern: '**/*.js', path: repo } });
    const named = (await steps()).flatMap((output) =>
      'toolName' in output && output.toolName ? [[output.kind, output.toolName]] : [],
    );
    for (const tool of ['Read', 'Grep', 'Glob']) {
      expect(named).toContainEqual(['step_started', tool]);
      expect(named).toContainEqual(['step_finished', tool]);
    }
  }, 120_000);
});
