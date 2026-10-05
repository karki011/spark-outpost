import { describe, expect, it } from 'vitest';
import { toAttention, type PendingApprovalRow } from './attention.ts';

const ID = '00000000-0000-4000-8000-0000000000a1';

function pending(overrides: Partial<PendingApprovalRow>): PendingApprovalRow {
  return {
    pending_id: ID,
    pending_kind: 'execute',
    pending_title: 'Run tests',
    pending_command: null,
    pending_paths: [],
    pending_agent: null,
    pending_member: null,
    pending_asker: null,
    pending_provider: 'claude',
    ...overrides,
  };
}

describe('toAttention', () => {
  it('has nothing to show without a pending approval', () => {
    expect(toAttention(pending({ pending_id: null }))).toBeNull();
    expect(toAttention(pending({ pending_kind: null }))).toBeNull();
  });

  it('phrases a command or an edit as a permission request from the asking agent', () => {
    expect(toAttention(pending({ pending_command: ' pnpm test ', pending_agent: 'Bolt' }))).toEqual(
      {
        kind: 'permission',
        title: 'run pnpm test',
        agentName: 'Bolt',
        provider: 'claude',
        approvalId: ID,
      },
    );
    expect(
      toAttention(pending({ pending_kind: 'edit', pending_paths: ['/repo/src/format.ts'] }))?.title,
    ).toBe('edit format.ts');
    expect(
      toAttention(pending({ pending_kind: 'edit', pending_paths: ['a.ts', 'b.ts', 7] }))?.title,
    ).toBe('edit 2 files');
    expect(toAttention(pending({ pending_kind: 'edit', pending_paths: null }))?.title).toBe(
      'change files',
    );
    expect(
      toAttention(pending({ pending_kind: 'other', pending_title: 'Fetch the docs' })),
    ).toMatchObject({
      kind: 'permission',
      title: 'fetch the docs',
      agentName: null,
    });
    expect(toAttention(pending({ pending_kind: 'other', pending_title: 'URL check' }))?.title).toBe(
      'URL check',
    );
  });

  it('credits the plan to the Architect and the changes to the Builder', () => {
    expect(
      toAttention(
        pending({
          pending_kind: 'plan',
          pending_title: 'Approve the plan',
          pending_member: 'Sketch',
          pending_provider: 'codex',
        }),
      ),
    ).toEqual({
      kind: 'plan',
      title: 'Approve the plan',
      agentName: 'Sketch',
      provider: 'codex',
      approvalId: ID,
    });
    expect(
      toAttention(pending({ pending_kind: 'accept', pending_title: 'Keep these changes?' })),
    ).toMatchObject({ kind: 'review', agentName: null });
  });

  it('treats questions and other checkpoints as input, with Jev asking clarifications', () => {
    expect(
      toAttention(pending({ pending_kind: 'clarify', pending_title: 'Which heading?' })),
    ).toMatchObject({ kind: 'input', title: 'Which heading?', agentName: 'Jev', provider: 'jev' });
    expect(
      toAttention(
        pending({
          pending_kind: 'clarify',
          pending_title: 'Bolt needs your input',
          pending_asker: 'Bolt',
        }),
      ),
    ).toMatchObject({ kind: 'input', agentName: 'Bolt', provider: 'claude' });
    expect(
      toAttention(
        pending({
          pending_kind: 'clarify',
          pending_title: 'A few questions first',
          pending_asker: 'Pip',
          pending_questions: true,
        }),
      ),
    ).toMatchObject({ kind: 'input', agentName: 'Spark', provider: 'claude' });
    expect(
      toAttention(
        pending({
          pending_kind: 'budget',
          pending_title: 'Continue past the budget?',
          pending_agent: 'Bolt',
        }),
      ),
    ).toMatchObject({ kind: 'input', title: 'Continue past the budget?', agentName: null });
  });

  it('marks a watchdog checkpoint as looks stuck, naming the member', () => {
    expect(
      toAttention(
        pending({
          pending_kind: 'stuck',
          pending_title: 'Bolt looks stuck',
          pending_asker: 'Bolt',
          pending_provider: 'claude',
        }),
      ),
    ).toEqual({
      kind: 'stuck',
      title: 'Bolt looks stuck',
      agentName: 'Bolt',
      provider: 'claude',
      approvalId: ID,
    });
  });
});
