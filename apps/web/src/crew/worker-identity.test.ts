import { expect, it } from 'vitest';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { chatBlob } from '../brand/ChatFace.tsx';
import { stageWorker, workerIdentity, workerPresentation, workerRole } from './worker-identity.ts';
import { chatAgent } from './chat-agent.ts';
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
