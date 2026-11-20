import { expect, it } from 'vitest';
import { createStatusStore } from './status-store.ts';

const report = { id: 'run', name: 'Claude', provider: 'claude', kind: 'agent' as const };

it('times a step from its own start when the turn knows it, else from when it was seen', () => {
  const store = createStatusStore(() => 100);
  store.report({ ...report, working: true, step: 'Read a.ts' });
  expect(store.snapshot().live[0]?.since).toBe(100);
  store.report({ ...report, working: true, step: 'Run gh pr create', startedAt: 40 });
  expect(store.snapshot().live[0]?.since).toBe(40);
});

it('keeps the time of the last output until the output moves on', () => {
  let clock = 100;
  const store = createStatusStore(() => clock);
  store.report({ ...report, working: true, step: null, outputSeq: 3 });
  clock = 500;
  store.report({ ...report, working: true, step: 'Read a.ts', outputSeq: 3 });
  expect(store.snapshot().live[0]?.outputAt).toBe(100);
  store.report({ ...report, working: true, step: 'Read a.ts', outputSeq: 4 });
  expect(store.snapshot().live[0]?.outputAt).toBe(500);
  store.report({ ...report, working: false, step: null });
  expect(store.snapshot().live[0]?.outputAt).toBeNull();
});
