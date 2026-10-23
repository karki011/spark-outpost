// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import {
  serviceNowAnswers,
  type Approval,
  type ServiceNowEditAction,
} from '@spark-outpost/contracts';
import { ApprovalCard } from './ApprovalCard.tsx';

afterEach(cleanup);

const RECORD = {
  table: 'incident' as const,
  number: 'INC0010023',
  sysId: 'a1b2c3',
  title: 'VPN drops',
  url: 'https://acme.service-now.com/nav_to.do',
  caller: 'Sam Ortiz',
};

function edit(op: ServiceNowEditAction['op']): ServiceNowEditAction {
  return {
    action: 'servicenow_edit',
    op,
    record: RECORD,
    updated: '2026-10-20 14:03:11',
    changes: {},
    before: null,
    after: null,
    note: 'Text for the record',
    move: null,
  };
}

function card(action: ServiceNowEditAction): Approval {
  const answers = serviceNowAnswers(action);
  return {
    id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    toolCallId: 'spark:servicenow_edit:1',
    kind: 'spark_action',
    title: answers.question,
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      sparkAction: action,
      sparkRequested: true,
    },
    payloadHash: 'sha256:abc',
    options: [
      { optionId: 'confirm', name: answers.confirm, kind: 'allow_once' },
      { optionId: 'decline', name: answers.decline, kind: 'reject_once' },
    ],
    status: 'pending',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-20T14:04:00.000Z',
  };
}

function show(approval: Approval) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApprovalCard approval={approval} provider="claude" agent="Bolt" repo={null} />
    </QueryClientProvider>,
  );
}

describe('ServiceNow cards', () => {
  it('focuses the confirm button of a requested work note, like other cards', () => {
    show(card(edit('work_note')));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add work note' }));
  });

  it('never focuses Post comment, so Return or Space cannot send to the caller', () => {
    show(card(edit('comment')));
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Post comment' }));
    expect(screen.getByText(/This asks in every mode/)).toBeTruthy();
  });
});
