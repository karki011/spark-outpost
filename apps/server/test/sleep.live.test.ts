import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { PermissionGate, ProviderOutput } from '../src/providers/provider.ts';

const folder = mkdtempSync(join(import.meta.dirname, '..', '..', '..', '.local', 'live-sleep-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const gate: PermissionGate = {
  review: async (request) => {
    const option = request.options.find((candidate) => candidate.kind === 'allow_once');
    if (!option) return { outcome: 'cancelled', note: 'No allow option' };
    return { outcome: 'selected', optionId: option.optionId, allowed: true, note: 'allowed' };
  },
};

describe('live Claude sleeping until a wakeup over ACP', () => {
  it('sleeps a minute, then replies in the same turn', { timeout: 240_000 }, async () => {
    const provider = createAcpProvider({ definition: agentDefinitions.claude });
    const outputs: { at: number; output: ProviderOutput }[] = [];
    const started = Date.now();
    for await (const output of provider.run({
      prompt:
        'Sleep for 1 minute using your ScheduleWakeup tool, then reply with the single word AWAKE.',
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: 'low' },
      signal: new AbortController().signal,
      projectRoots: [folder],
      chatFolder: true,
      mode: 'do',
      approvals: gate,
    })) {
      outputs.push({ at: Date.now() - started, output });
    }
    const text = outputs
      .map(({ output }) => (output.kind === 'text_delta' ? output.delta : ''))
      .join('');
    const waits = outputs.filter(({ output }) => output.kind === 'background_work');
    console.log('sleep live', {
      text,
      elapsedMs: Date.now() - started,
      waits: waits.map(({ at, output }) => ({ at, output })),
      steps: outputs.flatMap(({ output }) => (output.kind === 'step_started' ? [output.name] : [])),
    });
    const asleep = waits.find(
      ({ output }) => output.kind === 'background_work' && output.wakesAt !== undefined,
    );
    expect(asleep).toBeDefined();
    expect(text).toContain('AWAKE');
    expect(Date.now() - started).toBeGreaterThan(55_000);
  });
});
