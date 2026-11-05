import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentLaunch } from '../src/agents/acp/agents.ts';
import type { ProviderOutput } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FAKE_ACP_LAUNCH, replyText } from './fake-acp-support.ts';

const REJECTING_CODEX =
  'if printf %s "$CODEX_CONFIG" | grep -q default_permissions; then ' +
  'echo "failed to load configuration: default_permissions requires a [permissions] table" >&2; ' +
  'exit 1; fi; exec "$0" "$@"';

const rejecting: AgentLaunch = {
  command: 'sh',
  args: ['-c', REJECTING_CODEX, FAKE_ACP_LAUNCH.command, ...FAKE_ACP_LAUNCH.args],
};

const failing: AgentLaunch = {
  command: 'sh',
  args: ['-c', 'echo "failed to load configuration: broken" >&2; exit 1'],
};

const env = {
  ...childEnvironment(process.env),
  FAKE_ACP_MODES: JSON.stringify(
    ['read-only', 'ask-every-action', 'agent'].map((id) => [id, id, null, null]),
  ),
  CODEX_HOME: join(import.meta.dirname, 'no-codex-home'),
};

async function run(launch: AgentLaunch) {
  const provider = createAcpProvider({
    definition: agentDefinitions.codex,
    launch,
    cancelGraceMs: 2_000,
    env,
  });
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of provider.run({
      prompt: 'hello',
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      signal: new AbortController().signal,
    })) {
      outputs.push(output);
    }
  } catch (caught) {
    error = caught;
  }
  return { outputs, error };
}

describe('Codex config failures', { timeout: 30_000 }, () => {
  it('retries once in Codex plain sandbox and says so', async () => {
    const { outputs, error } = await run(rejecting);
    expect(error).toBeNull();
    expect(replyText(outputs)).toContain('Hello there');
    const notes = outputs.flatMap((output) =>
      output.kind === 'step_started' ? [output.name] : [],
    );
    expect(notes.some((note) => note.includes("Codex's own sandbox"))).toBe(true);
  });

  it('reports a clear error when the plain sandbox fails too', async () => {
    const { error } = await run(failing);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Codex/);
  });
});
