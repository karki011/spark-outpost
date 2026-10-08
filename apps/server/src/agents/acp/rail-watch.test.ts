import { describe, expect, it } from 'vitest';
import { createRailWatch } from './rail-watch.ts';

const ROOT = '/work/app';
const watch = () =>
  createRailWatch({ roots: [{ path: ROOT, ignore: [] }], cwd: ROOT, home: '/Users/me' });

const NOTHING = { rails: [], secretReads: [] };

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
    expect(await rails.observe(edit)).toEqual(NOTHING);
    expect((await rails.observe(done('e1'))).rails).toEqual([
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
    await rails.observe(started('c1', { kind: 'execute', rawInput: { command: 'rm .env' } }));
    rails.asked('c1');
    expect(await rails.observe(done('c1'))).toEqual(NOTHING);
    await rails.observe(started('r1', { kind: 'read', locations: [{ path: `${ROOT}/.env` }] }));
    rails.asked('r1');
    expect(await rails.observe(done('r1'))).toEqual(NOTHING);
  });

  it('marks an unasked instruction file edit as revertible in the project', async () => {
    const rails = watch();
    await rails.observe(
      started('i1', { kind: 'edit', locations: [{ path: `${ROOT}/AGENTS.md` }] }),
    );
    expect((await rails.observe(done('i1'))).rails).toMatchObject([
      { rail: 'instructions', paths: ['AGENTS.md'], inside: true },
    ]);
  });

  it('notes an unasked read of a secret file, in the project or outside it, without flagging it', async () => {
    const rails = watch();
    await rails.observe(started('c1', { kind: 'execute', rawInput: { command: 'cat .env' } }));
    expect(await rails.observe(done('c1'))).toEqual({ rails: [], secretReads: ['.env'] });
    await rails.observe(
      started('r1', { kind: 'read', locations: [{ path: `${ROOT}/config/.env.local` }] }),
    );
    expect(await rails.observe(done('r1'))).toEqual({
      rails: [],
      secretReads: ['config/.env.local'],
    });
    await rails.observe(started('c2', { kind: 'execute', rawInput: { command: 'cat ~/.npmrc' } }));
    expect(await rails.observe(done('c2'))).toEqual({ rails: [], secretReads: ['~/.npmrc'] });
    await rails.observe(
      started('r3', { kind: 'read', locations: [{ path: '/Users/me/.ssh/id_rsa' }] }),
    );
    expect(await rails.observe(done('r3'))).toEqual({ rails: [], secretReads: ['~/.ssh/id_rsa'] });
    await rails.observe(started('r2', { kind: 'read', locations: [{ path: `${ROOT}/a.ts` }] }));
    expect(await rails.observe(done('r2'))).toEqual(NOTHING);
  });

  it('still flags an unasked change to a secret file', async () => {
    const rails = watch();
    await rails.observe(started('c1', { kind: 'execute', rawInput: { command: 'rm .env' } }));
    expect(await rails.observe(done('c1'))).toMatchObject({
      rails: [{ rail: 'secret', paths: ['.env'] }],
      secretReads: [],
    });
    await rails.observe(started('e1', { kind: 'edit', locations: [{ path: `${ROOT}/.env` }] }));
    expect(await rails.observe(done('e1'))).toMatchObject({
      rails: [{ rail: 'secret', paths: ['.env'], inside: true }],
      secretReads: [],
    });
  });
});
