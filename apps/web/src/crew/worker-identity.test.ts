import { expect, it } from 'vitest';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { chatBlob } from '../brand/ChatFace.tsx';
import {
  teamAgents,
  stageWorker,
  workerIdentity,
  workerModel,
  workerModelLabel,
  workerPresentation,
  workerRole,
} from './worker-identity.ts';
import { chatAgent } from './chat-agent.ts';
import { headerMeta, modelLabel } from './crew-model.ts';
import { run } from './test-run.ts';

it('recognizes only explicit role names, never vague task descriptions', () => {
  expect(workerRole('Builder: login form')).toBe('Builder');
  expect(workerRole('[Reviewer] API changes')).toBe('Reviewer');
  expect(workerRole('Explore')).toBe('Explorer');
  expect(workerRole('Explorer readme')).toBe('Explorer');
  expect(workerRole('Builder summary')).toBe('Builder');
  expect(workerRole('BuildExplorer')).toBeNull();
  expect(workerRole('Find whether a builder is needed')).toBeNull();
  expect(workerRole('Tests')).toBeNull();
});

it('keeps an individual face through status changes and same-name workers distinct', () => {
  const row: SubagentRow = {
    ...emptySubagentRecord,
    id: 'worker-a',
    name: 'Builder',
    task: 'Build UI',
    parentId: null,
    state: 'working',
    step: null,
    startedAt: 1,
    endedAt: null,
  };
  const lead = chatAgent(run({ status: 'running' }), [], false);
  const worker = stageWorker(row, lead);
  const done = stageWorker({ ...row, state: 'done', usage: { tokens: 42 } }, lead);
  expect(chatBlob(workerIdentity(worker.id))).toEqual(chatBlob(workerIdentity(done.id)));
  expect(chatBlob(workerIdentity(worker.id)).name).not.toBe(
    chatBlob(workerIdentity('worker-b')).name,
  );
  expect(worker.model).toBeNull();
  expect(worker.tokens).toBeNull();
  expect(done.tokens).toBe(42);
  expect(done.state).toBe('done');
  expect(done.line).toBe('Done');
  expect(worker.line).toBe('Working');
  expect(stageWorker({ ...row, state: 'failed' }, lead).line).toBe('Failed');
  expect(stageWorker({ ...row, state: 'cancelled' }, lead).line).toBe('Stopped');
  expect(stageWorker({ ...row, step: 'x'.repeat(1000) }, lead).line.length).toBe(80);
});

it('keeps a stale worker inactive after the lead ends without inventing an outcome', () => {
  const row: SubagentRow = {
    ...emptySubagentRecord,
    id: 'stale-worker',
    name: 'Builder',
    task: 'Build UI',
    parentId: null,
    state: 'working',
    step: 'Writing code',
    startedAt: 1,
    endedAt: null,
  };
  for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
    const worker = stageWorker(row, chatAgent(run({ status })));
    expect(worker.state).toBe('inactive');
    expect(worker.line).toBe('Inactive');
  }
  const lead = chatAgent(run({ status: 'running' }));
  expect(stageWorker(row, lead).state).toBe('working');
  expect(stageWorker(row, { ...lead, state: 'waiting' }).state).toBe('working');
  expect(stageWorker({ ...row, state: 'done' }, chatAgent(run())).state).toBe('done');
});

it.each([
  ['working', true, 'Working', 'working'],
  ['working', false, 'Inactive', 'idle'],
  ['done', false, 'Done', 'done'],
  ['failed', false, 'Failed', 'failed'],
  ['cancelled', false, 'Stopped', 'archived'],
] as const)('shows %s workers truthfully when live=%s', (state, live, label, face) => {
  expect(workerPresentation(state, live)).toMatchObject({ label, face });
});

it('shows each worker once alongside the lead, preserving its identity', () => {
  const lead = chatAgent(run({ status: 'running' }));
  const worker: SubagentRow = {
    ...emptySubagentRecord,
    id: 'worker-a',
    name: 'Builder',
    task: 'Build UI',
    parentId: null,
    state: 'working',
    step: null,
    startedAt: 1,
    endedAt: null,
  };
  const team = teamAgents([lead], [worker, worker]);
  expect(team.map((agent) => agent.id)).toEqual([lead.id, worker.id]);
  expect(team[1]?.blobId).toBe(workerIdentity(worker.id));
  expect(teamAgents(team, [worker])).toEqual(team);
  expect(teamAgents([], [worker])).toEqual([]);
});

const unnamed: SubagentRow = {
  ...emptySubagentRecord,
  id: 'worker-m',
  name: 'Builder',
  task: '',
  parentId: null,
  state: 'working',
  step: null,
  startedAt: 1,
  endedAt: null,
};

it('names a worker model the way the lead model is named, with its effort', () => {
  expect(workerModel({ model: 'claude-opus-5-5', effort: 'high' })).toEqual({
    model: 'Opus 5.5',
    effort: 'high',
  });
  expect(workerModelLabel({ model: 'claude-opus-5-5', effort: 'high' })).toBe('Opus 5.5 · High');
  expect(workerModelLabel({ model: 'gpt-5.5' })).toBe('gpt-5.5');
  expect(workerModelLabel({ model: 'Opus 4.7' })).toBe('Opus 4.7');
  expect(workerModelLabel({ model: 'opus' })).toBe('Opus');
});

it('shows nothing for a worker whose model is unknown, effort included', () => {
  expect(workerModelLabel(undefined)).toBeNull();
  expect(workerModelLabel({ effort: 'high' })).toBeNull();
  expect(workerModelLabel({ model: 'default' })).toBeNull();
  const lead = chatAgent(run({ status: 'running' }), [], false);
  expect(modelLabel(stageWorker(unnamed, lead))).toBe('');
  expect(modelLabel({ ...lead, model: null, effort: null })).toBe('default model');
  expect(headerMeta(stageWorker(unnamed, lead))).not.toContain('default model');
});

it('puts the worker model and effort on the stage worker', () => {
  const lead = chatAgent(run({ status: 'running' }), [], false);
  const worker = stageWorker(
    { ...unnamed, usage: { model: 'claude-opus-5-5', effort: 'low' } },
    lead,
  );
  expect(worker).toMatchObject({ model: 'Opus 5.5', effort: 'low' });
  expect(modelLabel(worker)).toBe('Opus 5.5 · Low');
});

it('capitalises an effort and spells out xhigh', () => {
  expect(workerModelLabel({ model: 'claude-opus-5-5', effort: 'xhigh' })).toBe(
    'Opus 5.5 · Extra high',
  );
  expect(workerModelLabel({ model: 'claude-opus-5-5', effort: 'max' })).toBe('Opus 5.5 · Max');
});
