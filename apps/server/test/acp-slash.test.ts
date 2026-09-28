import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { SLASH_ESCAPE_NOTE } from '../src/agents/acp/slash-commands.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import type { ProviderOutput, SessionTarget, StoredSession } from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const store = mkdtempSync(join(tmpdir(), 'fake-acp-slash-'));
const workdir = join(store, 'workdir');
afterAll(() => rmSync(store, { recursive: true, force: true }));

const provider = createAcpProvider({
  definition: { ...agentDefinitions.codex, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
  env: {
    ...childEnvironment(process.env),
    FAKE_ACP_SESSION_STORE: store,
    FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {} }),
    FAKE_ACP_COMMANDS: JSON.stringify(['compact', 'review', 'logout']),
  },
});

async function turn(prompt: string, session: SessionTarget) {
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt,
    history: [{ role: 'user', content: 'earlier' }],
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    signal: new AbortController().signal,
    session,
  })) {
    outputs.push(output);
  }
  const text = replyText(outputs);
  const steps = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  return { outputs, text, steps };
}

async function storedSession(): Promise<StoredSession> {
  const first = await turn('Hello', { workdir, resume: null, freshReason: null });
  const opened = first.outputs.find((output) => output.kind === 'session');
  if (opened?.kind !== 'session') throw new Error('No session was reported.');
  expect(first.outputs).toContainEqual({
    kind: 'commands',
    commands: [
      { name: 'compact', description: 'Run compact', hint: null },
      { name: 'review', description: 'Run review', hint: 'what to review' },
      { name: 'logout', description: 'Run logout', hint: null },
    ],
  });
  return {
    sessionId: opened.sessionId,
    cwd: opened.cwd,
    additionalDirectories: opened.additionalDirectories,
    commands: ['compact', 'review', 'logout'],
  };
}

const resumed = (resume: StoredSession): SessionTarget => ({
  workdir,
  resume,
  freshReason: null,
});

describe('slash commands against the fake agent', { timeout: 30_000 }, () => {
  it('sends an advertised command as the first text of a continued session', async () => {
    const stored = await storedSession();
    const { text, steps } = await turn('/review the parser', resumed(stored));
    expect(text).toBe('command=/review args=the parser');
    expect(steps).toContain('Sent /review to Fake');
  });

  it('escapes unknown and blocked commands so the agent reads them as text', async () => {
    const stored = await storedSession();
    const unknown = await turn('/model gpt-9', resumed(stored));
    expect(unknown.text).not.toContain('command=');
    expect(unknown.text).toContain(`prompt=${SLASH_ESCAPE_NOTE}\n\n/model gpt-9`);
    expect(unknown.steps).toContain(
      'Blocked /model as a command (Spark Outpost sets the mode, model and permissions); sent as text',
    );
    const blocked = await turn('/logout', resumed(stored));
    expect(blocked.text).not.toContain('command=');
    expect(blocked.steps).toContain(
      'Blocked /logout as a command (sign-in is managed in Settings); sent as text',
    );
    const other = await turn('/deploy now', resumed(stored));
    expect(other.text).not.toContain('command=');
    expect(other.steps).toContain("Sent /deploy as text; it isn't a command Fake offered");
  });

  it('never runs a command in a fresh session, where the prompt starts with our note', async () => {
    const { text, steps } = await turn('/compact', { workdir, resume: null, freshReason: null });
    expect(text).not.toContain('command=');
    expect(steps).toContain('Sent /compact as text; commands only run in a continued session');
  });
});
