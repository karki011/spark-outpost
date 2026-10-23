import { describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { askReason, askerName } from './ask-reason.ts';

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
  it('names the sub-agent that asked', () => {
    const asked: Approval = {
      ...base,
      payload: { ...base.payload, subagent: 'Explore', agentReason: 'to create the file' },
    };
    expect(askReason(asked, 'Claude')).toBe(
      "Claude's sub-agent Explore asks because: to create the file",
    );
    expect(askerName(asked, 'Claude')).toBe("Claude's sub-agent Explore");
    expect(askerName(base, 'Claude')).toBe('Claude');
  });

  it('keeps the agent’s own reason when it gives one', () => {
    const own = { ...base, payload: { ...base.payload, agentReason: 'to create the file' } };
    expect(askReason(own, 'Claude')).toBe('Claude asks because: to create the file');
  });

  it('shows the agent’s note as a note when Spark is the one asking', () => {
    const payload = {
      ...base.payload,
      agentReason: 'This command requires approval',
      asksBecause:
        "Bolt shares this folder with 2 other pieces, and Spark couldn't tell what this command changes",
    };
    expect(askReason({ ...base, payload }, 'Claude')).toBe(
      'Claude noted: This command requires approval',
    );
  });

  it('explains a sandbox retry in plain words', () => {
    const sandbox = {
      ...base,
      payload: { ...base.payload, agentReason: 'command failed in the sandbox' },
    };
    expect(askReason(sandbox, 'Codex')).toContain("couldn't run this inside its sandbox");
  });

  it('adds no line when the agent gives no reason, since the card title says what it does', () => {
    expect(askReason(base, 'Claude')).toBeNull();
    expect(askReason(edit(['src/a.ts', 'src/b.ts']), 'Codex')).toBeNull();
    expect(askReason(edit(['src/a.ts']), 'Codex')).toBeNull();
  });

  it('leaves cards Spark explains itself alone', () => {
    expect(askReason({ ...base, reason: 'Git hooks always ask' }, 'Claude')).toBeNull();
    expect(
      askReason({ ...base, payload: { ...base.payload, plan: '1. Do it' } }, 'Claude'),
    ).toBeNull();
    expect(askReason({ ...base, kind: 'other', title: 'Fetch' }, 'Claude')).toBeNull();
  });
});
