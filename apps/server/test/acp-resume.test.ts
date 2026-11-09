import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { ProtocolEntry } from '../src/audit/protocol-entry.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { createAuditRecorder } from '../src/workflow/audit-recorder.ts';
import type {
  ConversationTurn,
  ProviderOutput,
  SessionTarget,
  StoredSession,
} from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const definition: AgentDefinition = {
  ...agentDefinitions.codex,
  name: 'Fake',
  ...FAKE_AGENT_MODES,
};
const store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
const workdir = join(store, 'workdir');
afterAll(() => rmSync(store, { recursive: true, force: true }));

function providerWith(capabilities: object, loadSession = false) {
  return createAcpProvider({
    definition,
    launch,
    cancelGraceMs: 2_000,
    env: {
      ...childEnvironment(process.env),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify(capabilities),
      ...(loadSession ? { FAKE_ACP_LOAD_SESSION: '1' } : {}),
    },
  });
}

const history: ConversationTurn[] = [
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
];

async function turn(
  provider: ReturnType<typeof providerWith>,
  prompt: string,
  session: SessionTarget,
  entries: ProtocolEntry[] = [],
  sessionTitle?: string,
) {
  const audit = createAuditRecorder({
    write: async (batch) => void entries.push(...batch),
    flushMs: 1,
  });
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt,
    history,
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    signal: new AbortController().signal,
    audit,
    session,
    ...(sessionTitle ? { sessionTitle } : {}),
  })) {
    outputs.push(output);
  }
  await audit.close();
  const text = replyText(outputs);
  const steps = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  const opened = outputs.find((output) => output.kind === 'session');
  return { outputs, text, steps, opened, audit };
}

const fresh: SessionTarget = { workdir, resume: null, freshReason: null };

async function firstSession(provider: ReturnType<typeof providerWith>): Promise<StoredSession> {
  const first = await turn(provider, 'Remember PELICAN', fresh);
  if (first.opened?.kind !== 'session') throw new Error('No session was reported.');
  expect(first.opened).toMatchObject({ continued: false, freshReason: null, cwd: workdir });
  expect(first.steps).not.toContain('Continued session');
  return {
    sessionId: first.opened.sessionId,
    cwd: first.opened.cwd,
    additionalDirectories: first.opened.additionalDirectories,
  };
}

const storedPrompts = (sessionId: string) =>
  (JSON.parse(readFileSync(join(store, `${sessionId}.json`), 'utf8')) as { prompts: string[] })
    .prompts;

describe('resuming ACP sessions against the fake agent', { timeout: 30_000 }, () => {
  it("names a new session with the chat's title and leaves a resumed one alone", async () => {
    const provider = providerWith({ resume: {}, title: {} });
    const firstEntries: ProtocolEntry[] = [];
    const first = await turn(provider, 'Remember PELICAN', fresh, firstEntries, 'Pelican notes');
    if (first.opened?.kind !== 'session') throw new Error('No session was reported.');
    const named = firstEntries.filter((entry) => entry.method === 'session/set_title');
    expect(JSON.stringify(named)).toContain('Pelican notes');
    const stored: StoredSession = {
      sessionId: first.opened.sessionId,
      cwd: first.opened.cwd,
      additionalDirectories: first.opened.additionalDirectories,
    };
    const laterEntries: ProtocolEntry[] = [];
    const later = await turn(
      provider,
      'What word? #recall',
      { workdir, resume: stored, freshReason: null },
      laterEntries,
      'Pelican notes',
    );
    expect(later.opened).toMatchObject({ continued: true });
    expect(laterEntries.map((entry) => entry.method)).not.toContain('session/set_title');
  });

  it('resumes with session/resume and sends only the new message', async () => {
    const provider = providerWith({ resume: {}, close: {} });
    const stored = await firstSession(provider);
    const second = await turn(provider, 'What word? #recall', {
      workdir,
      resume: stored,
      freshReason: null,
    });
    expect(second.opened).toMatchObject({ continued: true, sessionId: stored.sessionId });
    expect(second.steps).toContain('Continued session');
    expect(second.steps.some((step) => step.startsWith('Recalled'))).toBe(false);
    expect(second.text).toContain('Remember PELICAN');
    expect(storedPrompts(stored.sessionId)).toHaveLength(2);
    expect(storedPrompts(stored.sessionId)[1]).toBe('What word? #recall');
    const closes = JSON.parse(readFileSync(join(store, `${stored.sessionId}.json`), 'utf8')) as {
      closes: number;
    };
    expect(closes.closes).toBe(2);
  });

  it('loads with session/load when only loadSession is advertised and hides the replay', async () => {
    const provider = providerWith({}, true);
    const stored = await firstSession(provider);
    const entries: ProtocolEntry[] = [];
    const second = await turn(
      provider,
      'Next #recall',
      { workdir, resume: stored, freshReason: null },
      entries,
    );
    expect(second.opened).toMatchObject({ continued: true });
    expect(second.text).not.toContain('replayed reply');
    expect(second.steps).not.toContain('Replayed tool');
    expect(second.audit.toolCallCount()).toBe(0);
    const methods = entries.map((entry) => entry.method);
    expect(methods).toContain('session/load');
    const updates = entries.filter((entry) => entry.method === 'session/update');
    expect(JSON.stringify(updates)).not.toContain('replayed reply');
    expect(storedPrompts(stored.sessionId).at(-1)).toBe('Next #recall');
  });

  it('starts fresh with the history when the agent cannot resume', async () => {
    const provider = providerWith({});
    const stored = await firstSession(provider);
    const second = await turn(provider, 'Again', { workdir, resume: stored, freshReason: null });
    expect(second.opened).toMatchObject({ continued: false, freshReason: "agent can't resume" });
    expect(second.steps.some((step) => step.startsWith('Fresh session'))).toBe(false);
    expect(second.text).toContain('User: first question');
  });

  it('starts fresh when the stored session is gone or the folder moved', async () => {
    const provider = providerWith({ resume: {} });
    const missing = await turn(provider, 'Hi', {
      workdir,
      resume: { sessionId: 'gone', cwd: workdir, additionalDirectories: [] },
      freshReason: null,
    });
    expect(missing.opened).toMatchObject({ continued: false, freshReason: "couldn't resume" });
    expect(missing.text).toContain('User: first question');
    const stored = await firstSession(provider);
    const moved = await turn(provider, 'Hi', {
      workdir,
      resume: { ...stored, cwd: join(store, 'elsewhere') },
      freshReason: null,
    });
    expect(moved.opened).toMatchObject({ continued: false, freshReason: 'repos changed' });
  });

  it('notes why the harness chose a fresh session', async () => {
    const provider = providerWith({ resume: {} });
    const result = await turn(provider, 'Hi', {
      workdir,
      resume: null,
      freshReason: 'settings changed',
    });
    expect(result.steps).toContain('Fresh session (settings changed)');
    expect(result.opened).toMatchObject({ freshReason: 'settings changed' });
  });

  it('sends the follow-up text instead of the full prompt when continued', async () => {
    const provider = providerWith({ resume: {} });
    const stored = await firstSession(provider);
    const second = await turn(provider, 'Long builder prompt with every step', {
      workdir,
      resume: stored,
      freshReason: null,
      followUp: 'Fix the review findings #recall',
    });
    expect(second.opened).toMatchObject({ continued: true });
    expect(storedPrompts(stored.sessionId).at(-1)).toBe('Fix the review findings #recall');
  });
});
