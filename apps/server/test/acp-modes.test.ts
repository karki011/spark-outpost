import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type {
  ModeRequests,
  PermissionGate,
  ProviderOutput,
  ProviderTurn,
} from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const env = {
  ...childEnvironment(process.env),
  FAKE_ACP_MODES: JSON.stringify([
    ['read-only', 'Read-only', null, 'standard'],
    ['ask-every-action', 'Ask every time', null, 'standard'],
    ['acceptEdits', 'Accept edits', 'Automatically accept all file edits', 'standard'],
    ['agent', 'Approve for me', null, 'auto_review'],
    ['plan', 'Plan', null, 'plan'],
  ]),
};
const claude = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  env,
  cancelGraceMs: 2_000,
});
const codex = createAcpProvider({
  definition: { ...agentDefinitions.codex, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  env,
  cancelGraceMs: 2_000,
});
const neverAsked: PermissionGate = {
  review: () => Promise.reject(new Error('no permission request expected')),
};

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-acp-modes-')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function requests(): ModeRequests & { emit(mode: string): void } {
  const listeners = new Set<(mode: string) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(mode) {
      for (const listener of listeners) listener(mode);
    },
  };
}

async function run(
  provider: typeof claude,
  prompt: string,
  extra: Partial<ProviderTurn> = {},
  onOutput: (output: ProviderOutput) => void = () => undefined,
) {
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of provider.run({
      prompt,
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      projectRoots: [root],
      signal: new AbortController().signal,
      mode: 'do',
      approvals: neverAsked,
      ...extra,
    })) {
      outputs.push(output);
      onOutput(output);
    }
  } catch (caught) {
    error = caught;
  }
  const text = replyText(outputs);
  const steps = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  const settings = outputs.filter((output) => output.kind === 'session_settings');
  const capabilities = outputs.find((output) => output.kind === 'capabilities');
  return { text, steps, error, settings, capabilities };
}

describe('provider permission modes over ACP', { timeout: 20_000 }, () => {
  it("starts a Do run in the chat's chosen mode and reports every mode the agent offers", async () => {
    const result = await run(claude, 'hello', {
      settings: { method: 'cli', model: null, modelLabel: null, effort: null, mode: 'acceptEdits' },
    });
    expect(result.error).toBeNull();
    expect(result.text).toContain('mode=acceptEdits');
    expect(result.settings[0]).toMatchObject({ mode: 'acceptEdits' });
    expect(result.capabilities).toMatchObject({
      report: {
        modes: expect.arrayContaining([
          {
            id: 'acceptEdits',
            label: 'Accept edits',
            description: 'Automatically accept all file edits',
            kind: 'standard',
          },
        ]),
      },
    });
  });

  it('falls back to the asking mode, with a note, when the agent lacks the chosen one', async () => {
    const result = await run(claude, 'hello', {
      settings: { method: 'cli', model: null, modelLabel: null, effort: null, mode: 'dontAsk' },
    });
    expect(result.error).toBeNull();
    expect(result.text).toContain('mode=ask-every-action');
    expect(result.steps).toContain("Fake doesn't offer dontAsk here; using Ask every time");
  });

  it('keeps a worktree-only mode off the real checkout, and uses it in a worktree copy', async () => {
    const settings = {
      method: 'cli' as const,
      model: null,
      modelLabel: null,
      effort: null,
      mode: 'agent',
    };
    const checkout = await run(codex, 'hello', { settings });
    expect(checkout.text).toContain('mode=ask-every-action');
    expect(checkout.steps).toContain('agent runs only in a worktree copy; asking instead');
    const copy = await run(codex, 'hello', { settings, worktree: true });
    expect(copy.text).toContain('mode=agent');
  });

  it('shows a mode change the agent makes itself, and follows it', async () => {
    const result = await run(claude, '#modeswitch plan');
    expect(result.error).toBeNull();
    expect(result.steps).toContain('Fake switched to Plan mode');
    expect(result.settings.at(-1)).toMatchObject({ mode: 'plan' });
  });

  it('stops the run when the agent switches to a mode that may not run here', async () => {
    const result = await run(codex, '#modeswitch agent');
    expect(String(result.error)).toMatch(/switched to Approve for me mode, so the run was stopped/);
  });

  it('switches a running turn to the mode you pick, without a new session', async () => {
    const picks = requests();
    const result = await run(claude, '#waitmode acceptEdits', { modeRequests: picks }, (output) => {
      if (output.kind === 'session_settings') setTimeout(() => picks.emit('acceptEdits'), 50);
    });
    expect(result.error).toBeNull();
    expect(result.text).toContain('switched=acceptEdits');
    expect(result.steps).toContain('Fake switched to Accept edits mode');
    expect(result.settings.at(-1)).toMatchObject({ mode: 'acceptEdits' });
  });

  it('refuses a live switch to a worktree-only mode on the real checkout', async () => {
    const picks = requests();
    const result = await run(codex, '#waitmode agent', { modeRequests: picks }, (output) => {
      if (output.kind === 'session_settings') setTimeout(() => picks.emit('agent'), 50);
    });
    expect(result.error).toBeNull();
    expect(result.text).toContain('switched=ask-every-action');
    expect(result.steps).toContain(
      'Approve for me runs only in a worktree copy; the mode stays as it was',
    );
  });

  it("uses the provider's read-only mode for Ask runs and never the chat's Do mode", async () => {
    const result = await run(codex, 'hello', {
      mode: 'ask',
      settings: { method: 'cli', model: null, modelLabel: null, effort: null, mode: 'agent' },
    });
    expect(result.text).toContain('mode=read-only');
  });
});
