import { describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { askReason } from './ask-reason.ts';

const base: Approval = {
  id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  toolCallId: 'call_1',
  kind: 'execute',
  title: 'touch notes.txt',
  payload: { command: 'touch notes.txt', cwd: '/work', paths: [], diffs: [], truncated: false },
  payloadHash: 'sha256:abc',
  options: [],
  status: 'pending',
  reason: null,
  decisionOptionId: null,
  scope: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-10-03T10:00:00.000Z',
};

const edit = (paths: string[]): Approval => ({
  ...base,
  kind: 'edit',
  title: 'Edit files',
  payload: { ...base.payload, command: null, cwd: null, paths },
});

describe('askReason', () => {
  it('keeps the agent’s own reason when it gives one', () => {
    const own = { ...base, payload: { ...base.payload, agentReason: 'to create the file' } };
    expect(askReason(own, 'Claude')).toBe('Claude asks because: to create the file');
  });

  it('explains a sandbox retry in plain words', () => {
    const sandbox = {
      ...base,
      payload: { ...base.payload, agentReason: 'command failed in the sandbox' },
    };
    expect(askReason(sandbox, 'Codex')).toContain("couldn't run this inside its sandbox");
  });

  it('says what the tool call does when the agent gives no reason', () => {
    expect(askReason(base, 'Claude')).toBe('Claude wants to run `touch notes.txt`.');
    expect(askReason(edit(['src/a.ts', 'src/b.ts']), 'Codex')).toBe('Codex wants to edit 2 files.');
    expect(askReason(edit(['src/a.ts']), 'Codex')).toBe('Codex wants to edit `a.ts`.');
  });

  it('leaves cards Spark explains itself alone', () => {
    expect(askReason({ ...base, reason: 'Git hooks always ask' }, 'Claude')).toBeNull();
    expect(
      askReason({ ...base, payload: { ...base.payload, plan: '1. Do it' } }, 'Claude'),
    ).toBeNull();
    expect(askReason({ ...base, kind: 'other', title: 'Fetch' }, 'Claude')).toBeNull();
  });
});
