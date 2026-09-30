import { describe, expect, it } from 'vitest';
import type { ProjectMap } from '@spark-outpost/contracts';
import {
  buildStages,
  estimateLeft,
  stageCount,
  stageSentence,
  type BuildStages,
} from './build-stages.ts';
import { PROJECT, sampleMap } from './map-samples.ts';

type Status = NonNullable<ProjectMap['status']>;

function mapWith(status: Partial<Status>): ProjectMap {
  return {
    ...sampleMap(PROJECT, []),
    status: {
      mapId: '33333333-3333-4333-8333-333333333333',
      status: 'building',
      phase: 'index',
      progress: { done: 0, total: 0 },
      rulesVersion: 'test',
      builtCommit: null,
      builtAt: null,
      fileCount: 0,
      areaCount: 0,
      edgeCount: 0,
      timings: {},
      jevAreas: null,
      error: null,
      ...status,
    },
  };
}

const countOf = (build: BuildStages) => (build.active ? stageCount(build.active) : null);

const states = (maps: ProjectMap[], combined = false) =>
  buildStages(maps, combined).stages.map((stage) => `${stage.id}:${stage.state}`);

describe('buildStages', () => {
  it('shows the reader counting files while the index runs', () => {
    const stages = buildStages([mapWith({ progress: { done: 1240, total: 5487 } })], false);
    expect(states([mapWith({})])).toEqual(['read:active', 'trace:next', 'label:next']);
    expect(stages.active).toMatchObject({ doing: 'Reading files' });
    expect(countOf(stages)).toBe('1,240 / 5,487');
    expect(stages.share).toBeCloseTo(1240 / 5487 / 3);
  });

  it('says Jev is labelling only while Jev is actually being asked', () => {
    const asking = buildStages(
      [mapWith({ phase: 'labels', progress: { done: 34, total: 268 }, jevAreas: 268 })],
      false,
    );
    expect(asking.active).toMatchObject({
      doing: 'Jev is labelling areas',
      jev: true,
      state: 'active',
    });
    expect(countOf(asking)).toBe('34 / 268');
    const beyondCap = buildStages(
      [mapWith({ phase: 'labels', progress: { done: 300, total: 320 }, jevAreas: 300 })],
      false,
    );
    expect(beyondCap.active).toMatchObject({ doing: 'Labelling the rest with rules', jev: false });
    const before = buildStages([mapWith({ phase: 'graph' })], false);
    expect(before.stages[2]).toMatchObject({ doing: 'Labelling areas', jev: false });
  });

  it('shows Jev asleep with rule-based labels when Jev is not connected', () => {
    const rules = buildStages(
      [mapWith({ phase: 'labels', progress: { done: 3, total: 9 }, jevAreas: 0 })],
      false,
    );
    expect(rules.active).toMatchObject({
      doing: 'Jev not connected, labelling with rules',
      state: 'asleep',
      jev: false,
    });
  });

  it('puts every blob to sleep while agents run', () => {
    const paused = buildStages([mapWith({ status: 'paused', phase: 'graph' })], false);
    expect(paused.stages.map((stage) => stage.state)).toEqual(['done', 'asleep', 'asleep']);
    expect(stageSentence(paused)).toBe(
      'Paused while agents run. The map picks up when they finish.',
    );
  });

  it('adds the linker for combined maps and follows the least finished project', () => {
    const maps = [mapWith({ status: 'ready', phase: 'done' }), mapWith({ phase: 'graph' })];
    expect(states(maps, true)).toEqual(['read:done', 'trace:active', 'label:next', 'link:next']);
    expect(states([mapWith({ status: 'queued' })])).toEqual([
      'read:next',
      'trace:next',
      'label:next',
    ]);
    expect(buildStages([mapWith({ status: 'queued' })], false).waiting).toBe(true);
  });
});

describe('estimateLeft', () => {
  const sample = { key: 'labels', at: 0, done: 0 };

  it('waits for enough progress before guessing', () => {
    expect(estimateLeft(sample, 2_000, 10, 100)).toBeNull();
    expect(estimateLeft(sample, 20_000, 0, 100)).toBeNull();
  });

  it('rounds to whole minutes', () => {
    expect(estimateLeft(sample, 60_000, 25, 100)).toBe('about 3 min left');
    expect(estimateLeft(sample, 10_000, 50, 100)).toBe('less than a minute left');
  });
});
