// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, RulesEditAction } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { phoneKeys } from '../../phone/phone-api.ts';
import { ApprovalCard } from './ApprovalCard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const action: RulesEditAction = {
  action: 'rules_edit',
  target: 'user',
  add: [{ effect: 'allow', rule: 'Gh(release create)' }],
  remove: [{ effect: 'deny', rule: 'Push(force)' }],
  fileHash: 'abc',
  agent: 'Claude',
  modeName: 'Bypass permissions',
  provider: 'claude',
  agentMode: 'bypassPermissions',
  sessionRow: null,
};

function card(target: RulesEditAction['target'] = 'user'): Approval {
  return {
    id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    toolCallId: 'spark:rules_edit:1',
    kind: 'spark_action',
    title: 'Change your Spark rules?',
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      sparkAction: { ...action, target },
    },
    payloadHash: 'sha256:abc',
    options: [
      { optionId: 'session', name: 'Allow for this session', kind: 'allow_always' },
      { optionId: 'confirm', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
    ],
    status: 'pending',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-24T10:00:00.000Z',
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

describe('the Spark rules card', () => {
  it('shows who asks, the change and three answers with one primary', async () => {
    const decide = vi.spyOn(approvalsApi, 'decide').mockReturnValue(new Promise(() => undefined));
    show(card());
    const group = screen.getByRole('group', { name: /Change your Spark rules\?/ });
    expect(group.textContent).toContain('Claude · Bypass permissions wants to edit settings.json');
    const changes = within(group).getByRole('list', { name: 'Rule changes' });
    expect(changes.textContent).toContain('allow Gh(release create)');
    expect(changes.textContent).toContain('deny Push(force)');
    expect(group.textContent).toContain('Asks again if you switch the agent or its mode.');
    const session = within(group).getByRole('button', { name: 'Allow for this session' });
    const once = within(group).getByRole('button', { name: 'Allow once' });
    expect(session.className).toContain('primary');
    expect(once.className).not.toContain('primary');
    fireEvent.click(session);
    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide.mock.calls[0]![1]).toMatchObject({ optionId: 'session', scope: 'once' });
  });

  it('names the company file and the admin password', () => {
    show(card('managed'));
    const group = screen.getByRole('group', { name: /Change your company’s rules\?/ });
    expect(group.textContent).toContain('wants to edit managed-settings.json');
    expect(group.textContent).toContain('macOS then asks for an admin password');
  });

  it('waits for the Mac on a paired device', () => {
    show(card(), true);
    const group = screen.getByRole('group', { name: /Change your Spark rules\?/ });
    expect(within(group).queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(group.textContent).toContain('Waiting for you on your Mac.');
  });
});
