import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createAcpProvider, LOST_CYCLE } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import type {
  AgentSettings,
  PermissionGate,
  Provider,
  ProviderOutput,
  SessionTarget,
} from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';
import { methodLog, sessionOf, waitFor } from './live-session-support.ts';

const store = mkdtempSync(join(tmpdir(), 'fake-acp-live-'));
afterAll(() => rmSync(store, { recursive: true, force: true }));

const CAPABILITIES = { resume: {}, close: {} };
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };
const providers: Provider[] = [];

function providerFor(base: AgentDefinition, log: string, liveIdleMs?: number): Provider {
  const provider = createAcpProvider({
    definition: { ...base, name: 'Fake', ...FAKE_AGENT_MODES },
    launch,
    cancelGraceMs: 2_000,
    ...(liveIdleMs ? { liveIdleMs } : {}),
    env: {
      ...childEnvironment(process.env),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify(CAPABILITIES),
      FAKE_ACP_METHOD_LOG: log,
      FAKE_ACP_BACKGROUND_MS: '200',
    },
  });
  providers.push(provider);
  return provider;
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.sessions?.closeAll()));
});

interface Chat {
  provider: Provider;
  conversationId: string;
  workdir: string;
  session: SessionTarget['resume'];
}

function chat(provider: Provider): Chat {
  return {
    provider,
    conversationId: crypto.randomUUID(),
    workdir: mkdtempSync(join(store, 'chat-')),
    session: null,
  };
}

interface Send {
  prompt?: string;
  mode?: string;
  continuation?: boolean;
  approvals?: PermissionGate;
  project?: string;
  signal?: AbortSignal;
  onOutput?: (output: ProviderOutput) => void;
}

async function send(target: Chat, send: Send = {}) {
  const outputs: ProviderOutput[] = [];
  for await (const output of target.provider.run({
    prompt: send.prompt ?? 'hello',
    history: [],
    settings: { ...settings, mode: send.mode ?? null },
    signal: send.signal ?? new AbortController().signal,
    session: { workdir: target.workdir, resume: target.session, freshReason: null },
    live: {
      conversationId: target.conversationId,
      ...(send.continuation ? { continuation: true } : {}),
    },
    ...(send.approvals ? { approvals: send.approvals } : {}),
    ...(send.project ? { projectRoots: [send.project], mode: 'do' as const } : {}),
  })) {
    outputs.push(output);
    send.onOutput?.(output);
  }
  target.session = sessionOf(outputs) ?? target.session;
  return { outputs, text: replyText(outputs) };
}

const claude = agentDefinitions.claude;

describe('ACP provider with one live session per chat', { timeout: 30_000 }, () => {
  it('sends later messages to the live session without a new initialize or resume', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));

    await send(target, { prompt: 'one' });
    const second = await send(target, { prompt: 'two' });
    const third = await send(target, { prompt: 'three' });

    expect(log.methods()).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
      'session/prompt',
      'session/prompt',
    ]);
    expect(log.pids().size).toBe(1);
    expect(second.text).toContain('prompt=two');
    expect(third.outputs.find((output) => output.kind === 'session')).toMatchObject({
      continued: true,
      live: true,
    });
    expect(
      third.outputs.some(
        (output) => output.kind === 'step_started' && output.name === 'Continued session',
      ),
    ).toBe(true);
  });

  it('switches the mode on the live session between messages', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));

    const project = mkdtempSync(join(store, 'project-'));
    const approvals: PermissionGate = {
      review: async () => ({ outcome: 'cancelled', note: 'Not asked' }),
    };
    const first = await send(target, { mode: 'default', project, approvals });
    const second = await send(target, { mode: 'acceptEdits', project, approvals });

    expect(first.text).toContain('mode=default');
    expect(second.text).toContain('mode=acceptEdits');
    expect(log.count('initialize')).toBe(1);
  });

  it('closes and resumes when the session the chat continues is another one', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));
    await send(target);
    const earlier = target.session;
    target.session = null;

    await send(target);
    target.session = earlier;
    await send(target);

    expect(log.methods()).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
      'session/close',
      'initialize',
      'session/new',
      'session/prompt',
      'session/close',
      'initialize',
      'session/resume',
      'session/prompt',
    ]);
  });

  it('reopens with a resume after the live process exits between messages', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));
    await send(target);
    process.kill(Number([...log.pids()][0]), 'SIGKILL');
    await waitFor(() => target.provider.sessions?.conversations().length === 0);

    const after = await send(target, { prompt: 'after' });

    expect(after.text).toContain('prompt=after');
    expect(log.count('session/resume')).toBe(1);
    expect(log.pids().size).toBe(2);
  });

  it('kills the process on Stop and resumes on the next message', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));
    await send(target);
    const stop = new AbortController();
    await send(target, {
      prompt: '#slow',
      signal: stop.signal,
      onOutput: (output) => {
        if (output.kind === 'text_delta') stop.abort();
      },
    });
    expect(target.provider.sessions?.conversations()).toEqual([]);

    await send(target, { prompt: 'next' });

    expect(log.count('session/resume')).toBe(1);
    expect(log.pids().size).toBe(2);
  });

  it('closes an idle live session after the idle time', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file, 300));
    await send(target);

    await waitFor(() => log.count('session/close') === 1);

    expect(target.provider.sessions?.conversations()).toEqual([]);
    await send(target);
    expect(log.count('session/resume')).toBe(1);
  });

  it('asks for a run when the agent continues on its own, and records it there', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));
    const cycles: string[] = [];
    target.provider.sessions?.onCycle((id) => cycles.push(id));

    const first = await send(target, { prompt: '#later' });
    await waitFor(() => cycles.length > 0);
    const continued = await send(target, { continuation: true });

    expect(first.text).toBe("I'll check back on my own.");
    expect(cycles).toEqual([target.conversationId]);
    expect(continued.text).toBe('Woke up on my own: checked.');
    expect(log.count('session/prompt')).toBe(1);
    expect(log.count('initialize')).toBe(1);
  });

  it('fails the agent’s own turn when its session is already gone', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));

    await expect(send(target, { continuation: true })).rejects.toThrow(LOST_CYCLE);
    expect(log.methods()).toEqual([]);
  });

  it('records a cycle that opens with a usage update as one run, up to its real end', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));
    const cycles: string[] = [];
    target.provider.sessions?.onCycle((id) => cycles.push(id));

    await send(target, { prompt: '#laterlead' });
    await waitFor(() => cycles.length > 0);
    const continued = await send(target, { continuation: true });

    expect(continued.text).toBe('Woke up on my own: checked.');
  });

  it('holds a permission request that arrives between turns for the next run’s gate', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(claude, log.file));
    const cycles: string[] = [];
    target.provider.sessions?.onCycle((id) => cycles.push(id));
    const reviewed: string[] = [];
    const approvals: PermissionGate = {
      review: async (request) => {
        reviewed.push(request.title);
        return { outcome: 'selected', optionId: 'no', allowed: false, note: 'Declined by test' };
      },
    };

    const project = mkdtempSync(join(store, 'project-'));
    await send(target, { prompt: '#laterask', project, approvals });
    await waitFor(() => cycles.length > 0);
    const continued = await send(target, { continuation: true, project, approvals });

    expect(continued.text).toBe('Woke up on my own: no.');
    expect(reviewed).toHaveLength(1);
  });

  it('keeps a Codex chat on one live session too', async () => {
    const log = methodLog(store);
    const target = chat(providerFor(agentDefinitions.codex, log.file));

    await send(target);
    await send(target);

    expect(log.count('initialize')).toBe(1);
    expect(log.count('session/prompt')).toBe(2);
  });

  it('closes every live session on closeAll', async () => {
    const log = methodLog(store);
    const provider = providerFor(claude, log.file);
    await send(chat(provider));
    await send(chat(provider));

    await provider.sessions?.closeAll();

    expect(log.count('session/close')).toBe(2);
    expect(provider.sessions?.conversations()).toEqual([]);
  });
});
