import { describe, expect, it } from 'vitest';
import { createRailWatch } from './rail-watch.ts';

const ROOT = '/work/app';
const watch = () =>
  createRailWatch({ roots: [{ path: ROOT, ignore: [] }], cwd: ROOT, home: '/Users/me' });

const started = (toolCallId: string, fields: Record<string, unknown>) => ({
  sessionUpdate: 'tool_call',
  toolCallId,
  status: 'pending',
  ...fields,
});
const done = (toolCallId: string) => ({
  sessionUpdate: 'tool_call_update',
  toolCallId,
  status: 'completed',
});

describe('watching actions the agent took without asking', () => {
  it('flags a finished edit outside the project, with a copy of the original', async () => {
    const rails = watch();
    const edit = started('e1', {
      kind: 'edit',
      title: 'Edit ~/x.txt',
      content: [{ type: 'diff', path: '/Users/me/x.txt', oldText: 'before', newText: 'after' }],
    });
    expect(await rails.observe(edit)).toEqual([]);
    expect(await rails.observe(done('e1'))).toEqual([
      {
        toolCallId: 'e1',
        rail: 'outside_write',
        paths: ['~/x.txt'],
        inside: false,
        originals: [{ path: '~/x.txt', text: 'before' }],
      },
    ]);
  });

  it('leaves actions the agent asked about to the approval gate', async () => {
    const rails = watch();
    await rails.observe(started('c1', { kind: 'execute', rawInput: { command: 'cat .env' } }));
    rails.asked('c1');
    expect(await rails.observe(done('c1'))).toEqual([]);
  });

  it('marks an unasked instruction file edit as revertible in the project', async () => {
    const rails = watch();
    await rails.observe(
      started('i1', { kind: 'edit', locations: [{ path: `${ROOT}/AGENTS.md` }] }),
    );
    expect(await rails.observe(done('i1'))).toMatchObject([
      { rail: 'instructions', paths: ['AGENTS.md'], inside: true },
    ]);
  });
});
