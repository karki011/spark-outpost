import { describe, expect, it } from 'vitest';
import { attributeFailure, touchedFailures, type BaseEvidence } from './attribution.ts';

const failed = (failures: string[], shape = 'x', output = '') => ({ failures, shape, output });

const base = (overrides: Partial<BaseEvidence>): BaseEvidence => ({
  outcome: 'passed',
  trusted: true,
  failures: [],
  shape: 'base',
  ...overrides,
});

const OLD = 'test libs/dates/src/holidays.test.ts';
const MINE = 'test libs/a/src/a.test.ts';

describe('which failures the diff touches', () => {
  it('counts a changed test file, a changed subject of a test and a changed file with errors', () => {
    const ids = [
      MINE,
      'test libs/b/src/__tests__/b.spec.tsx',
      'type libs/c/src/c.ts TS2322',
      'lint libs/d/src/d.ts',
      OLD,
    ];
    const changed = ['libs/a/src/a.test.ts', 'libs/b/src/b.tsx', 'libs/c/src/c.ts'];
    expect(touchedFailures(ids, changed)).toEqual(ids.slice(0, 3));
  });

  it('matches a path the tool printed from a package folder', () => {
    expect(touchedFailures(['test src/a.test.ts'], ['libs/a/src/a.test.ts'])).toEqual([
      'test src/a.test.ts',
    ]);
  });

  it('ties a task to the change only when no file is named and a changed folder has its name', () => {
    const tasks = ['task @acme/dashboards-api:test', 'task web#lint'];
    expect(touchedFailures(tasks, ['libs/dashboards-api/src/x.ts'])).toEqual([tasks[0]]);
    expect(touchedFailures(tasks, ['docs/readme.md'])).toEqual([]);
    expect(touchedFailures([...tasks, OLD], ['apps/web/src/x.ts'])).toEqual([]);
  });
});

describe('who a failing check is attributed to', () => {
  it('blames the change when a comparable run on the base commit passed', () => {
    expect(attributeFailure(failed([OLD]), [], base({}))).toMatchObject({
      cause: 'change',
      blamed: [OLD],
    });
  });

  it('does not rely on a pass it cannot trust: untouched files are unknown, touched ones are the change', () => {
    const cached = base({ trusted: false });
    expect(attributeFailure(failed([OLD, 'task dates:test']), ['libs/a/src/a.ts'], cached)).toEqual(
      { cause: 'unknown', blamed: [], shared: [], added: [] },
    );
    expect(attributeFailure(failed([OLD, MINE]), ['libs/a/src/a.ts'], cached)).toMatchObject({
      cause: 'change',
      blamed: [MINE],
    });
  });

  it('is unknown without a baseline, with one that timed out, or with one that could not run', () => {
    const none = [null, base({ outcome: 'timed_out' }), base({ outcome: 'unavailable' })];
    for (const evidence of none) {
      expect(attributeFailure(failed([OLD]), ['notes.txt'], evidence).cause).toBe('unknown');
      expect(attributeFailure(failed([]), ['notes.txt'], evidence).cause).toBe('unknown');
      expect(attributeFailure(failed([MINE]), ['libs/a/src/a.test.ts'], evidence).cause).toBe(
        'change',
      );
    }
  });

  it('calls failures the base has too pre-existing, and only new ones the change', () => {
    const red = base({ outcome: 'failed', failures: [OLD] });
    expect(attributeFailure(failed([OLD]), [], red)).toEqual({
      cause: 'baseline',
      blamed: [],
      shared: [OLD],
      added: [],
    });
    expect(attributeFailure(failed([OLD, MINE]), [], red)).toEqual({
      cause: 'change',
      blamed: [MINE],
      shared: [OLD],
      added: [MINE],
    });
  });

  it('needs the diff to touch a new failure when the failing baseline is not trusted', () => {
    const stale = base({ outcome: 'failed', failures: [OLD], trusted: false });
    expect(attributeFailure(failed([OLD, MINE]), ['docs/a.md'], stale).cause).toBe('unknown');
    expect(attributeFailure(failed([OLD, MINE]), ['libs/a/src/a.ts'], stale).cause).toBe('change');
  });

  it('does not read new names as new failures when the base run named none', () => {
    const brokeEarly = base({ outcome: 'failed', failures: [] });
    expect(attributeFailure(failed([OLD]), ['docs/a.md'], brokeEarly).cause).toBe('unknown');
    expect(attributeFailure(failed([MINE]), ['libs/a/src/a.ts'], brokeEarly).cause).toBe('change');
  });

  it('compares the output when no failure is named, and never blames on a different shape alone', () => {
    const red = base({ outcome: 'failed', shape: 'boom' });
    expect(attributeFailure(failed([], 'boom'), [], red).cause).toBe('baseline');
    expect(attributeFailure(failed([], 'other'), [], red).cause).toBe('unknown');
  });

  it('ties an unnamed failure to the change when its output names a changed file', () => {
    const red = base({ outcome: 'failed', shape: 'boom' });
    const broken = failed([], 'other', 'Error: api.ts is broken\n    at check (tools/run.mjs:3:1)');
    expect(attributeFailure(broken, ['api.ts'], red).cause).toBe('change');
    expect(attributeFailure(broken, ['api.ts'], null).cause).toBe('change');
    expect(attributeFailure(broken, ['pi.ts', 'docs/api.tsx'], null).cause).toBe('unknown');
    expect(attributeFailure(failed([], 'boom', 'api.ts is broken'), ['api.ts'], red).cause).toBe(
      'baseline',
    );
  });
});
