import { describe, expect, it } from 'vitest';
import { crewExpression, crewStateWord, crewTotals, headerMeta, totalsLine } from './crew-model.ts';
import { crewAgents, dispatchParts, runAgent } from './crew-projection.ts';
import { checkpoint, member, orchestration } from './test-orchestration.ts';

const decision = {
  id: '00000000-0000-4000-8000-0000000000d1',
  kind: 'intake' as const,
  role: null,
  stepIndex: null,
  childRunId: null,
  summary: 'Intake',
  applied: 'jev' as const,
  gate: null,
  jevStatus: 'answered' as const,
  jevError: null,
  latencyMs: 2_900,
  tokens: 1_000,
  costUsd: 0.0001,
  answer: { intent: 'fix', complexity: 2 },
  createdAt: '2026-09-26T10:02:01.000Z',
};

describe('crew agents', () => {
  it('names agents from the engine and shows the header meta once', () => {
    const builder = member({ name: 'Builder 2', agentLabel: 'Builder 2 · Sonnet 5 · medium' });
    const agent = runAgent(builder, orchestration());
    expect(agent.name).toBe('Builder 2');
    expect(headerMeta(agent)).toBe('Sonnet 5 · medium · 12.4K tokens · $0.03 · 38s');
  });

  it('follows run status, tool calls, and the pending checkpoint for the state', () => {
    const running = member({ status: 'running', toolCalls: 0, planStep: 'Add a midnight test' });
    expect(runAgent(running, orchestration()).state).toBe('thinking');
    expect(runAgent(running, orchestration()).line).toBe('add a midnight test');

    const editing = member({ status: 'running', toolCalls: 2 });
    const agent = runAgent(editing, orchestration(), [
      { name: 'Read `a.ts`', done: true },
      { name: 'Edit `turns.ts`', done: false },
    ]);
    expect(agent).toMatchObject({ state: 'working', line: 'edit turns.ts' });

    const gate = checkpoint({ kind: 'plan' }, { runId: editing.runId });
    expect(runAgent(editing, orchestration({ pendingCheckpoint: gate })).state).toBe('waiting');
    expect(runAgent(member({ status: 'queued', role: 'critic' }), orchestration()).line).toBe(
      'queued for review',
    );
    expect(runAgent(member({ verdict: 'looks_good' }), orchestration()).line).toBe('looks good');
  });

  it('shows a stopped agent as stopped and sleepy, not failed', () => {
    const stopped = runAgent(member({ status: 'cancelled' }), orchestration());
    expect(stopped).toMatchObject({ state: 'stopped', line: 'stopped' });
    expect(crewStateWord(stopped.state)).toBe('Stopped');
    expect(crewExpression(stopped.state)).toBe('sleepy');
    const failed = runAgent(member({ status: 'failed' }), orchestration());
    expect(failed).toMatchObject({ state: 'failed', line: 'hit a problem' });
    expect(crewStateWord(failed.state)).toBe('Failed');
  });

  it('puts Jev first and merges retries of the same agent', () => {
    const first = member({ runId: '00000000-0000-4000-8000-0000000000b1', status: 'failed' });
    const retry = member({ runId: '00000000-0000-4000-8000-0000000000b2', attempt: 2 });
    const critic = member({
      runId: '00000000-0000-4000-8000-0000000000b3',
      role: 'critic',
      name: 'Critic',
      agentLabel: 'Critic · GPT-5 Codex · high',
      provider: 'codex',
      status: 'running',
      costSource: 'estimated',
      costUsd: 0.04,
    });
    const run = orchestration({
      crew: [first, retry, critic],
      decisions: [decision],
      totals: {
        ...orchestration().totals,
        tokens: 37_200,
        costUsd: 0.102,
        costSource: 'mixed',
        jevTokens: 1_000,
        jevCostUsd: 0.0001,
      },
    });
    const agents = crewAgents(run);
    expect(agents.map((agent) => agent.name)).toEqual(['Jev', 'Builder', 'Critic']);
    expect(agents[0]).toMatchObject({
      state: 'done',
      durationMs: 2_900,
      tokens: 1_000,
      costUsd: 0.0001,
    });
    expect(agents[1]).toMatchObject({ id: retry.runId, tokens: 24_800, state: 'done' });
    expect(totalsLine(crewTotals(run.totals, agents.length - 1))).toBe(
      '2 agents · 38.2K tokens · ~$0.10 · Jev ~<$0.001',
    );
  });

  it('shows Jev waiting while a checkpoint is open', () => {
    const agents = crewAgents(
      orchestration({ pendingCheckpoint: checkpoint({ kind: 'clarify' }) }),
    );
    expect(agents[0]).toMatchObject({ state: 'waiting', line: 'waiting on you' });
  });

  it('describes the dispatch as complexity and depth, leaving the category to its chip', () => {
    expect(dispatchParts(orchestration({ decisions: [decision] }), undefined)).toEqual([
      'normal',
      'plan → execute',
    ]);
    expect(dispatchParts(orchestration({ depth: 'direct' }), undefined)).toEqual(['direct']);
  });
});
