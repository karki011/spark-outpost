// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, CrewEditAction, SparkAction } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { phoneKeys } from '../../phone/phone-api.ts';
import { ApprovalCard } from './ApprovalCard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SKILL =
  '---\nname: notes\ndescription: Write release notes\n---\nList merged pull requests.\n';

const sparkEdit: CrewEditAction = {
  action: 'crew_edit',
  target: 'spark',
  id: '7f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  name: 'Scout',
  files: [
    { path: 'skills/notes/SKILL.md', change: 'new', before: null, after: SKILL, baseHash: null },
    {
      path: 'SPARK.md',
      change: 'changed',
      before: 'Be brief.\nName the file.\n',
      after: 'Be thorough.\nName the file.\n',
      baseHash: 'abc',
    },
    { path: 'old.sh', change: 'deleted', before: 'echo old\n', after: null, baseHash: 'def' },
  ],
  similar: [{ kind: 'skill', name: 'release-notes', spark: 'Scribe', reason: 'similar_name' }],
  agent: 'Claude',
  modeName: 'Bypass permissions',
};

const workflowEdit: CrewEditAction = {
  action: 'crew_edit',
  target: 'workflow',
  id: 'nightly',
  name: 'Nightly',
  files: [
    {
      path: 'nightly.json',
      change: 'new',
      before: null,
      after: '{\n  "id": "nightly"\n}\n',
      baseHash: null,
    },
  ],
  stages: [['Scout', 'Security'], ['Scribe']],
  similar: [],
  agent: 'Codex',
  modeName: 'Full access',
};

function card(action: SparkAction, title: string): Approval {
  return {
    id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    toolCallId: 'spark:crew_edit:1',
    kind: 'spark_action',
    title,
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      sparkAction: action,
    },
    payloadHash: 'sha256:abc',
    options: [
      { optionId: 'confirm', name: 'Allow', kind: 'allow_once' },
      { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
    ],
    status: 'pending',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-11-13T10:00:00.000Z',
  };
}

function show(approval: Approval, remote = false) {
  const client = new QueryClient();
  client.setQueryData(phoneKeys.session, { remote, switches: {} });
  render(
    <QueryClientProvider client={client}>
      <ApprovalCard approval={approval} provider="claude" agent="Claude" repo={null} />
    </QueryClientProvider>,
  );
}

describe('the card for a change to a Spark', () => {
  it('lists each file as new, changed or deleted with its lines before and after', () => {
    show(card(sparkEdit, 'Change the Scout Spark?'));
    const group = screen.getByRole('group', { name: /Change the Scout Spark\?/ });
    expect(group.textContent).toContain('Claude · Bypass permissions wants to change 3 files');
    const files = within(group).getByRole('list', { name: 'File changes' });
    const added = within(files).getByRole('region', { name: 'Changes to skills/notes/SKILL.md' });
    expect(added.textContent).toContain('description: Write release notes');
    expect(added.textContent).toContain('List merged pull requests.');
    const changed = within(files).getByRole('region', { name: 'Changes to SPARK.md' });
    expect(changed.querySelector('.dv-row.remove')!.textContent).toContain('Be brief.');
    expect(changed.querySelector('.dv-row.add')!.textContent).toContain('Be thorough.');
    const removed = within(files).getByRole('region', { name: 'Changes to old.sh' });
    expect(removed.querySelector('.dv-row.remove')!.textContent).toContain('echo old');
    expect(removed.querySelector('.dv-row.add')).toBeNull();
    const badges = [...files.querySelectorAll('.dv-badge')].map((badge) => badge.textContent);
    expect(badges).toEqual(['New', 'Changed', 'Deleted']);
  });

  it('names what the user already has that is similar', () => {
    show(card(sparkEdit, 'Change the Scout Spark?'));
    expect(screen.getByRole('note').textContent).toBe(
      'You already have the release-notes skill of Scribe (similar name).',
    );
  });

  it('answers only by a click on Allow or Deny, with no focus on either', async () => {
    const decide = vi.spyOn(approvalsApi, 'decide').mockReturnValue(new Promise(() => undefined));
    show(card(sparkEdit, 'Change the Scout Spark?'));
    const group = screen.getByRole('group', { name: /Change the Scout Spark\?/ });
    const allow = within(group).getByRole('button', { name: 'Allow' });
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(group, { key: 'Enter' });
    fireEvent.keyDown(group, { key: 'y' });
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide.mock.calls[0]![1]).toMatchObject({ optionId: 'decline', scope: 'once' });
    expect(allow.className).toContain('soft');
  });

  it('waits for the Mac on a paired device', () => {
    show(card(sparkEdit, 'Change the Scout Spark?'), true);
    const group = screen.getByRole('group', { name: /Change the Scout Spark\?/ });
    expect(within(group).queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(within(group).queryByRole('button', { name: 'Deny' })).toBeNull();
    expect(group.textContent).toContain('Answered on the Mac only.');
    expect(within(group).getByRole('region', { name: 'Changes to SPARK.md' })).toBeTruthy();
  });
});

describe('the card for a change to a workflow', () => {
  it('names the workflow, its steps in order and the file', () => {
    show(card(workflowEdit, 'Change the Nightly workflow?'));
    const group = screen.getByRole('group', { name: /Change the Nightly workflow\?/ });
    expect(group.textContent).toContain('Codex · Full access wants to change the workflow file');
    expect(group.textContent).toContain('Scout + Security → Scribe');
    expect(within(group).getByRole('region', { name: 'Changes to nightly.json' })).toBeTruthy();
  });
});

describe('the card for a new or changed Spark', () => {
  const face = { shape: 'round', color: 'teal' } as const;
  const fields = {
    name: 'Scouts',
    role: 'Reviewer',
    face,
    faceAuto: true,
    provider: null,
    model: null,
    agentMode: null,
    level: null,
    projects: [],
  };

  it('names a similar Spark and waits for the Mac on a paired device', () => {
    const action = {
      action: 'create_teammate',
      ...fields,
      instructions: 'Review code.',
      similar: [{ kind: 'spark', name: 'Scout', spark: null, reason: 'similar_name' }],
    } as SparkAction;
    show(card(action, 'Add this Spark? Scouts'), true);
    expect(screen.getByRole('note').textContent).toBe(
      'You already have the Scout Spark (similar name).',
    );
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
    expect(screen.getByRole('group').textContent).toContain('Answered on the Mac only.');
  });

  it('shows the instructions a change replaces', () => {
    const action = {
      action: 'update_teammate',
      teammateId: '7f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
      ...fields,
      instructions: 'Be kind.',
      instructionsBefore: 'Be brief.',
      changed: ['instructions'],
    } as SparkAction;
    show(card(action, 'Change this Spark? Scouts'));
    const diff = screen.getByRole('region', { name: 'Changes to SPARK.md' });
    expect(diff.querySelector('.dv-row.remove')!.textContent).toContain('Be brief.');
    expect(diff.querySelector('.dv-row.add')!.textContent).toContain('Be kind.');
  });
});
