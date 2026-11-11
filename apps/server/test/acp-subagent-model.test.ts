import { describe, expect, it } from 'vitest';
import { EventType, type RunEvent } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { subagentsFromEvents } from '../src/persistence/subagents.ts';
import type { AgentSettings, ProviderOutput } from '../src/providers/provider.ts';
import { createSubagentProgress } from '../src/workflow/subagent-progress.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch } from './fake-acp-support.ts';

const provider = createAcpProvider({
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

function storedRows(outputs: readonly ProviderOutput[]) {
  const progress = createSubagentProgress({ storable: (text) => text });
  const events: RunEvent[] = outputs.flatMap((output) => progress.observe(output));
  const rowsAt = (count: number) =>
    subagentsFromEvents(events.slice(0, count).map((payload) => ({ run_id: 'run-1', payload })))[
      'run-1'
    ] ?? [];
  return { events, rowsAt };
}

describe('a sub-agent model reported by the agent', { timeout: 20_000 }, () => {
  it('reaches the stored roster before the sub-agent ends and leaves the lead settings alone', async () => {
    const outputs = await collect('#subagentsmodel');
    const reports = outputs.filter((output) => output.kind === 'subagent_report');
    expect(reports).toEqual([
      {
        kind: 'subagent_report',
        id: 'sub-1',
        report: { usage: { model: 'child-model-b', effort: 'low' } },
      },
    ]);
    const settingsReports = outputs.filter((output) => output.kind === 'session_settings');
    expect(JSON.stringify(settingsReports)).not.toContain('child-model');

    const { events, rowsAt } = storedRows(outputs);
    const ended = events.findIndex(
      (event) =>
        event.type === EventType.SUBAGENT_FINISHED || event.type === EventType.SUBAGENT_ERROR,
    );
    expect(ended).toBeGreaterThan(0);
    const before = rowsAt(ended)[0];
    expect(before?.state).toBe('working');
    expect(before?.usage).toEqual({ model: 'child-model-b', effort: 'low' });
    const after = rowsAt(events.length)[0];
    expect(after?.state).toBe('done');
    expect(after?.usage).toEqual({ model: 'child-model-b', effort: 'low' });
  });
});
