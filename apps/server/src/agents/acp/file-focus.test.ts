import { describe, expect, it } from 'vitest';
import { createFocusTracker, fileFocus } from './file-focus.ts';
import { createUpdateMapper } from './session-updates.ts';

describe('which file a tool call is looking at', () => {
  it('takes the path and line from ACP locations for any provider', () => {
    expect(fileFocus('read', [{ path: '/repo/src/invoice.ts', line: 40 }], { limit: 20 })).toEqual({
      path: '/repo/src/invoice.ts',
      line: 40,
      limit: 20,
      action: 'read',
    });
    expect(fileFocus('edit', [{ path: '/repo/a.ts' }], { limit: 5 })).toEqual({
      path: '/repo/a.ts',
      line: null,
      limit: null,
      action: 'edit',
    });
  });

  it('falls back to the common path fields and ignores a zero or missing line', () => {
    expect(fileFocus('read', [], { file_path: '/repo/b.ts' })?.path).toBe('/repo/b.ts');
    expect(fileFocus('read', [{ path: '/repo/b.ts', line: 0 }], null)?.line).toBeNull();
    expect(fileFocus('read', null, { limit: 3 })).toBeNull();
  });

  it('has nothing for commands, searches and unknown kinds', () => {
    for (const kind of ['execute', 'search', 'fetch', 'think', 'other', null, undefined]) {
      expect(fileFocus(kind, [{ path: '/repo/a.ts' }], {})).toBeNull();
    }
    expect(fileFocus('read', [{ path: 'x'.repeat(5000) }], {})).toBeNull();
    expect(fileFocus('read', [], { file_path: '/work/app/.env' })).toBeNull();
  });

  it('reports a tool call once until what it looks at changes', () => {
    const tracker = createFocusTracker();
    const first = tracker.see('t', 'read', [{ path: '/repo/a.ts', line: 1 }], {});
    expect(first).toEqual([
      { kind: 'file_focus', path: '/repo/a.ts', line: 1, limit: null, action: 'read' },
    ]);
    expect(tracker.see('t', 'read', [{ path: '/repo/a.ts', line: 1 }], {})).toEqual([]);
    expect(tracker.see('t', 'read', [{ path: '/repo/a.ts', line: 30 }], {})).toHaveLength(1);
    tracker.done('t');
    expect(tracker.see('t', 'read', [{ path: '/repo/a.ts', line: 30 }], {})).toHaveLength(1);
  });
});

describe('file focus in the session update mapper', () => {
  it('reports the file before the step, and again when a later update names it', () => {
    const mapper = createUpdateMapper();
    const started = mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'r',
      title: 'Read /repo/src/invoice.ts',
      kind: 'read',
      status: 'pending',
      locations: [{ path: '/repo/src/invoice.ts', line: 12 }],
      rawInput: { file_path: '/repo/src/invoice.ts', offset: 12, limit: 30 },
    });
    expect(started.map((output) => output.kind)).toEqual(['file_focus', 'step_started']);
    expect(started[0]).toMatchObject({ path: '/repo/src/invoice.ts', line: 12, limit: 30 });

    expect(
      mapper.map({ sessionUpdate: 'tool_call', toolCallId: 'e', title: 'Edit', kind: 'edit' }),
    ).toEqual([expect.objectContaining({ kind: 'step_started' })]);
    const late = mapper.map({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'e',
      locations: [{ path: '/repo/src/totals.ts' }],
    });
    expect(late).toEqual([
      { kind: 'file_focus', path: '/repo/src/totals.ts', line: null, limit: null, action: 'edit' },
    ]);
    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'gone',
        kind: 'read',
        locations: [{ path: '/repo/x.ts' }],
      }),
    ).toEqual([]);
  });

  it('adds nothing to a command', () => {
    const outputs = createUpdateMapper().map({
      sessionUpdate: 'tool_call',
      toolCallId: 'c',
      title: 'pnpm test',
      kind: 'execute',
      rawInput: { command: 'pnpm test' },
    });
    expect(outputs.map((output) => output.kind)).toEqual(['step_started']);
  });
});
