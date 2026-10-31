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
