import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { ApprovalRequest } from '../src/approvals/decide.ts';
import type { AgentSettings, PermissionGate, ProviderOutput } from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const definition: AgentDefinition = {
  ...agentDefinitions.codex,
  name: 'Fake',
  ...FAKE_AGENT_MODES,
};
const provider = createAcpProvider({ definition, launch, cancelGraceMs: 2_000 });
const claude = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
});
const settings: AgentSettings = { method: 'cli', model: null, modelLabel: null, effort: null };

async function collect(prompt: string) {
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt,
    history: [],
    settings,
    signal: new AbortController().signal,
  })) {
    outputs.push(output);
  }
  return outputs;
}

describe('ACP provider with an agent that reports its sub-agents', { timeout: 20_000 }, () => {
  it('records each sub-agent, attributes its tool calls and keeps its words out of the reply', async () => {
    const outputs = await collect('#subagents');
    expect(replyText(outputs)).toBe('Launching. All done');
    const lifecycle = outputs.filter((output) => output.kind.startsWith('subagent_'));
    expect(lifecycle).toEqual([
      {
        kind: 'subagent_started',
        id: 'sub-1',
        parentId: null,
        name: 'Explore',
        task: 'Find the routes',
      },
      {
        kind: 'subagent_started',
        id: 'sub-2',
        parentId: null,
        name: 'Tests',
        task: 'Run the tests',
      },
      {
        kind: 'subagent_started',
        id: 'sub-3',
        parentId: 'sub-1',
        name: 'Nested',
        task: 'Look deeper',
      },
      { kind: 'subagent_finished', id: 'sub-3', state: 'done' },
      { kind: 'subagent_finished', id: 'sub-1', state: 'done' },
      { kind: 'subagent_finished', id: 'sub-2', state: 'failed' },
    ]);
    const steps = outputs.flatMap((output) =>
      output.kind === 'step_started' && output.tool
        ? [`${output.subagent ?? 'main'}: ${output.name}`]
        : [],
    );
    expect(steps).toEqual([
      'sub-1: Starting a subagent',
      'sub-2: Starting a subagent',
      'sub-1: Read routes.ts',
      'sub-3: Read deep.ts',
      'sub-2: Read tests.ts',
    ]);
    const closed = outputs.flatMap((output) =>
      output.kind === 'step_finished' && output.subagent ? [output.subagent] : [],
    );
    expect(closed).toEqual(['sub-1', 'sub-2', 'sub-3', 'sub-1', 'sub-2']);
    const calls = outputs.flatMap((output) =>
      output.kind === 'tool_started' ? [[output.id, output.subagent]] : [],
    );
    expect(calls).toEqual([
      ['c1', 'sub-1'],
      ['c3', 'sub-3'],
      ['c2', 'sub-2'],
    ]);
  });

  it('names the sub-agent that asks for permission and attributes the answer to it', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'spark-acp-subagents-')));
    const requests: ApprovalRequest[] = [];
    const approvals: PermissionGate = {
      review: async (request) => {
        requests.push(request);
        return { outcome: 'selected', optionId: 'yes', allowed: true, note: 'Allowed it' };
      },
    };
    const outputs: ProviderOutput[] = [];
    try {
      for await (const output of claude.run({
        prompt: '#subagentsask',
        history: [],
        settings,
        projectRoots: [root],
        signal: new AbortController().signal,
        mode: 'do',
        approvals,
      })) {
        outputs.push(output);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect(requests).toEqual([expect.objectContaining({ toolCallId: 'p1', subagent: 'Explore' })]);
    expect(outputs).toContainEqual({ kind: 'step_started', name: 'Allowed it', subagent: 'sub-1' });
    expect(outputs).toContainEqual(
      expect.objectContaining({ kind: 'subagent_started', id: 'sub-1', task: '' }),
    );
  });

  it('stops a command a sub-agent left running, even after the agent dropped its shell', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'spark-acp-orphan-')));
    const pidFile = join(dir, 'pid');
    const controller = new AbortController();
    const outputs: ProviderOutput[] = [];
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    let pid = 0;
    try {
      for await (const output of provider.run({
        prompt: `#orphan ${pidFile}`,
        history: [],
        settings,
        signal: controller.signal,
      })) {
        outputs.push(output);
        if (output.kind !== 'subagent_started') continue;
        await vi.waitFor(async () => {
          pid = Number((await readFile(pidFile, 'utf8')).trim());
          expect(pid).toBeGreaterThan(0);
        });
        expect(alive(pid)).toBe(true);
        controller.abort();
      }
      await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
      expect(await readFile(`${pidFile}.stopped`, 'utf8')).toBe('shell killed');
    } finally {
      if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL');
      await rm(dir, { recursive: true, force: true });
    }
  });
});
