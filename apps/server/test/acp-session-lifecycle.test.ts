import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import { COMPACTED_LINE } from '../src/agents/acp/compaction-lines.ts';
import type { ProtocolEntry } from '../src/audit/protocol-entry.ts';
import type { ProviderOutput, SessionTarget } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { createAuditRecorder } from '../src/workflow/audit-recorder.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const definition: AgentDefinition = {
  ...agentDefinitions.codex,
  name: 'Fake',
  ...FAKE_AGENT_MODES,
};
const logs = mkdtempSync(join(tmpdir(), 'acp-session-lifecycle-'));
afterAll(() => rmSync(logs, { recursive: true, force: true }));

let logCount = 0;

interface Setup {
  capabilities?: object;
  deletes?: 'hang' | 'fail';
}

function providerWith(setup: Setup = {}) {
  logCount += 1;
  const methods = join(logs, `methods-${logCount}.log`);
  const cancels = join(logs, `cancels-${logCount}.log`);
  const provider = createAcpProvider({
    definition,
    launch,
    cancelGraceMs: 4_000,
    env: {
      ...childEnvironment(process.env),
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify(setup.capabilities ?? { delete: {} }),
      FAKE_ACP_METHOD_LOG: methods,
      FAKE_ACP_CANCEL_LOG: cancels,
      ...(setup.deletes ? { FAKE_ACP_DELETE: setup.deletes } : {}),
    },
  });
  const read = (file: string) => {
    try {
      return readFileSync(file, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  return {
    provider,
    methods: () => read(methods).map((line) => line.slice(line.indexOf(' ') + 1)),
    cancels: () => read(cancels),
  };
}

interface RunOptions {
  session?: SessionTarget;
  stopWhen?: (output: ProviderOutput) => boolean;
}

async function run(
  provider: ReturnType<typeof providerWith>['provider'],
  prompt: string,
  options: RunOptions = {},
) {
  const controller = new AbortController();
  const entries: ProtocolEntry[] = [];
  const audit = createAuditRecorder({
    write: async (batch) => void entries.push(...batch),
    flushMs: 1,
  });
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of provider.run({
      prompt,
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      signal: controller.signal,
      audit,
      ...(options.session ? { session: options.session } : {}),
    })) {
      outputs.push(output);
      if (options.stopWhen?.(output)) {
        controller.abort();
        controller.abort();
      }
    }
  } catch (caught) {
    error = caught;
  }
  await audit.close();
  return { outputs, entries, error, text: replyText(outputs) };
}

const steps = (outputs: readonly ProviderOutput[]) =>
  outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));

describe('throwaway ACP sessions', { timeout: 20_000 }, () => {
  it('deletes a session Spark will never resume once its turn ends', async () => {
    const fake = providerWith();
    const { text, error } = await run(fake.provider, 'hello');
    expect(error).toBeNull();
    expect(text).not.toBe('');
    expect(fake.methods()).toContain('session/delete fake-session');
  });

  it('keeps a session Spark may resume and closes it instead', async () => {
    const fake = providerWith({ capabilities: { delete: {}, close: {} } });
    const session: SessionTarget = { workdir: join(logs, 'kept'), resume: null, freshReason: null };
    const { error } = await run(fake.provider, 'hello', { session });
    expect(error).toBeNull();
    expect(fake.methods().some((method) => method.startsWith('session/delete'))).toBe(false);
  });

  it('never asks to delete when the agent does not offer it', async () => {
    const fake = providerWith({ capabilities: {} });
    const { error } = await run(fake.provider, 'hello');
    expect(error).toBeNull();
    expect(fake.methods().some((method) => method.startsWith('session/delete'))).toBe(false);
  });

  it.each(['hang', 'fail'] as const)(
    'still ends the turn on time with its reply when the delete answers %s',
    async (deletes) => {
      const fake = providerWith({ deletes });
      const started = Date.now();
      const { text, error } = await run(fake.provider, 'hello');
      expect(error).toBeNull();
      expect(text).not.toBe('');
      expect(fake.methods()).toContain('session/delete fake-session');
      expect(Date.now() - started).toBeLessThan(8_000);
    },
  );

  it('deletes a stopped throwaway session after the agent answers the cancel', async () => {
    const fake = providerWith();
    const { error } = await run(fake.provider, '#slow', {
      stopWhen: (output) => output.kind === 'text_delta',
    });
    expect(error).toBeNull();
    expect(fake.cancels()).toEqual(['fake-session']);
    expect(fake.methods()).toContain('session/delete fake-session');
  });
});

describe('stopping an ACP turn', { timeout: 20_000 }, () => {
  it('sends session/cancel once as a notification and ends on the cancelled stop reason', async () => {
    const fake = providerWith();
    const { entries, error } = await run(fake.provider, '#slow', {
      stopWhen: (output) => output.kind === 'text_delta',
    });
    expect(error).toBeNull();
    const protocol = entries.filter((entry) => entry.kind !== 'stderr');
    const cancels = protocol.filter((entry) => entry.method === 'session/cancel');
    expect(cancels).toHaveLength(1);
    expect(cancels[0]).toMatchObject({ direction: 'to_agent', kind: 'notification', rpcId: null });
    const cancelAt = protocol.indexOf(cancels[0]!);
    const answer = protocol.findIndex(
      (entry, index) =>
        index > cancelAt && entry.method === 'session/prompt' && entry.direction === 'from_agent',
    );
    expect(answer).toBeGreaterThan(cancelAt);
    expect(protocol[answer]!.payload).toMatchObject({ result: { stopReason: 'cancelled' } });
    expect(fake.cancels()).toEqual(['fake-session']);
  });
});

describe('ACP compaction updates from the agent', { timeout: 20_000 }, () => {
  it('shows one Context compacted line, keeps the reply and leaves the summary out', async () => {
    const fake = providerWith();
    const { outputs, text, error } = await run(fake.provider, '#compacting');
    expect(error).toBeNull();
    expect(steps(outputs).filter((name) => name === COMPACTED_LINE)).toHaveLength(1);
    expect(text).toBe('Carried on after compacting.');
  });
});
