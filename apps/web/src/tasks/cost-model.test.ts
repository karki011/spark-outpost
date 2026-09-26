import { describe, expect, it } from 'vitest';
import type { Run, TaskDetail, TaskRun } from '@spark-outpost/contracts';
import { costSummary, modelTier, runIdentities } from './cost-model.ts';
import { prettyModelId } from './model-names.ts';

const ids = ['a', 'b', 'c', 'd'].map((letter) => `00000000-0000-4000-8000-00000000000${letter}`);

function taskRun(index: number, overrides: Partial<TaskRun>): TaskRun {
  return {
    id: ids[index]!,
    provider: 'claude',
    model: 'sonnet',
    effort: 'medium',
    status: 'succeeded',
    planVersion: null,
    tokens: 1000,
    costUsd: 0.01,
    costSource: 'reported',
    mode: 'do',
    durationMs: 1000,
    createdAt: '2026-09-26T00:00:00.000Z',
    ...overrides,
  };
}

function task(runs: TaskRun[], extra: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: ids[0]!,
    conversationId: ids[1]!,
    title: 'Task',
    status: 'open',
    createdAt: '2026-09-26T00:00:00.000Z',
    closedAt: null,
    runIds: runs.map((run) => run.id),
    planVersion: null,
    items: [],
    summary: { done: 0, total: 0, waiting: 0, text: '' },
    costUsd: null,
    tokens: null,
    runs,
    planVersions: [],
    links: [],
    ...extra,
  };
}

const namer = (_provider: string, model: string | null) =>
  model ? prettyModelId(model) : 'Default';

describe('costSummary', () => {
  it('groups crew runs by agent with display model names and adds Jev as an estimate', () => {
    const detail = task(
      [
        taskRun(0, { model: 'opus[1m]', effort: 'high', costUsd: 0.2, tokens: 20_000 }),
        taskRun(1, { costUsd: 0.03 }),
        taskRun(2, { costUsd: 0.02, tokens: 500 }),
      ],
      { advisors: [{ advisor: 'jev', calls: 3, inputTokens: 2300, costUsd: 0.0001 }] },
    );
    const identities = runIdentities(
      detail,
      [],
      [
        { id: ids[0]!, name: 'Sketch', role: 'architect' },
        { id: ids[1]!, name: 'Bolt', role: 'builder' },
        { id: ids[2]!, name: 'Bolt', role: 'builder' },
      ],
    );
    const summary = costSummary({ task: detail, runs: [], identities, modelName: namer });
    expect(
      summary.rows.map((row) => [
        row.name,
        row.role,
        row.model,
        row.turns,
        row.tokens,
        row.estimated,
      ]),
    ).toEqual([
      ['Sketch', 'Architect', 'Opus', 1, 20_000, false],
      ['Bolt', 'Builder', 'Sonnet', 2, 1500, false],
      ['Jev', 'Dispatcher', null, 3, 2300, true],
    ]);
    expect(summary.rows[1]!.costUsd).toBeCloseTo(0.05);
    expect(summary.costUsd).toBeCloseTo(0.2501);
    expect(summary.source).toBe('mixed');
    expect(summary.slices.map((slice) => [slice.label, slice.tier])).toEqual([
      ['Opus', 2],
      ['Sonnet', 1],
      ['Jev', null],
    ]);
  });

  it('groups solo turns by provider, model and effort and skips runs with no usage', () => {
    const detail = task([
      taskRun(0, {
        provider: 'codex',
        model: 'gpt-6-luna',
        effort: 'low',
        costSource: 'estimated',
      }),
      taskRun(1, {
        provider: 'codex',
        model: 'gpt-6-luna',
        effort: 'low',
        costSource: 'estimated',
      }),
      taskRun(2, { model: 'haiku', effort: null }),
      taskRun(3, { tokens: null, costUsd: null }),
    ]);
    const summary = costSummary({
      task: detail,
      runs: [],
      identities: new Map(),
      modelName: namer,
    });
    expect(summary.rows.map((row) => [row.name, row.model, row.turns, row.estimated])).toEqual([
      ['Codex', 'gpt-6-luna', 2, true],
      ['Claude', 'Haiku', 1, false],
    ]);
    expect(summary.source).toBe('mixed');
  });

  it('splits tokens into input, output and cached reads from run usage', () => {
    const detail = task([taskRun(0, {})]);
    const usage = {
      contextUsed: null,
      contextSize: null,
      costUsd: 0.01,
      tokens: {
        input: 800,
        output: 150,
        total: 950,
        cachedRead: 600,
        cachedWrite: null,
        thought: null,
      },
    };
    const runs = [{ id: ids[0]!, usage } as unknown as Run];
    const summary = costSummary({ task: detail, runs, identities: new Map(), modelName: namer });
    expect(summary.split).toEqual({ input: 800, output: 150, cached: 600 });
  });
});

describe('dispatcher usage', () => {
  it('adds Jev from the live crew when the task has no advisor records', () => {
    const summary = costSummary({
      task: task([taskRun(0, {})]),
      runs: [],
      identities: new Map(),
      modelName: namer,
      dispatcher: { tokens: 1800, costUsd: 0.00007 },
    });
    expect(summary.rows.at(-1)).toMatchObject({ name: 'Jev', tokens: 1800, estimated: true });
  });
});

describe('modelTier', () => {
  it('ranks model families from light to heavy', () => {
    expect(modelTier('haiku')).toBe(0);
    expect(modelTier('gpt-6-sol')).toBe(1);
    expect(modelTier(null, 'Opus 5.5')).toBe(2);
    expect(modelTier('fake-fast')).toBeNull();
  });
});
