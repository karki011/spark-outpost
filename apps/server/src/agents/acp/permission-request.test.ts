import { describe, expect, it } from 'vitest';
import { approvalRequestFrom, permissionResponse } from './permission-request.ts';

const context = {
  rpcId: '12',
  roots: [{ path: '/work/app', ignore: [] }],
  cwd: '/work/app',
  home: '/Users/me',
};

const options = [
  { optionId: 'allow', name: 'Yes', kind: 'allow_once' as const },
  { optionId: 'always', name: 'Always', kind: 'allow_always' as const },
  { optionId: 'no', name: 'No', kind: 'reject_once' as const },
];

describe('approvalRequestFrom', () => {
  it('maps a Claude Bash request to a command', () => {
    const request = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'toolu_1',
          title: 'ls -la',
          kind: 'execute',
          rawInput: { command: 'ls -la', description: 'List files' },
        },
        options,
      },
      context,
    );
    expect(request).toMatchObject({
      toolCallId: 'toolu_1',
      rpcId: '12',
      kind: 'execute',
      command: 'ls -la',
      cwd: '/work/app',
      paths: [],
      options,
    });
  });

  it('maps an edit with a diff and a relative location to absolute paths', () => {
    const request = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'toolu_2',
          title: 'Edit src/a.ts',
          kind: 'edit',
          rawInput: { file_path: '/work/app/src/a.ts', old_string: 'a', new_string: 'b' },
          content: [{ type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' }],
          locations: [{ path: '/work/app/src/a.ts' }],
        },
        options,
      },
      context,
    );
    expect(request).toMatchObject({
      kind: 'edit',
      command: null,
      paths: ['/work/app/src/a.ts'],
      diffs: [{ path: '/work/app/src/a.ts', oldText: 'a', newText: 'b' }],
    });
  });

  it('joins array commands and keeps unknown tools as other', () => {
    const codex = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: {
          toolCallId: 'c',
          title: 'Run',
          kind: 'execute',
          rawInput: { command: ['git', 'push'] },
        },
        options,
      },
      context,
    );
    expect(codex.command).toBe('git push');
    const other = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: { toolCallId: 'x', title: 'Fetch docs', kind: 'fetch' },
        options,
      },
      context,
    );
    expect(other).toMatchObject({ kind: 'other', toolKind: 'fetch', title: 'Fetch docs' });
  });

  it('drops option kinds it does not know', () => {
    const request = approvalRequestFrom(
      {
        sessionId: 's',
        toolCall: { toolCallId: 'x', title: 'Do it' },
        options: [...options, { optionId: 'odd', name: 'Odd', kind: 'something' as 'allow_once' }],
      },
      context,
    );
    expect(request.options).toEqual(options);
  });
});

describe('permissionResponse', () => {
  it('selects the answered option or cancels', () => {
    expect(
      permissionResponse({ outcome: 'selected', optionId: 'allow', allowed: true, note: '' }),
    ).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(permissionResponse({ outcome: 'cancelled', note: '' })).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });
});
