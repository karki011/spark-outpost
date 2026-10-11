// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanDocument } from '@spark-outpost/contracts';
import { AgreedPlan } from './AgreedPlan.tsx';

afterEach(cleanup);

function plan(version: number, overrides: Partial<PlanDocument>): PlanDocument {
  return {
    id: `00000000-0000-4000-8000-00000000000${version}`,
    conversationId: '00000000-0000-4000-8000-0000000000aa',
    taskId: null,
    version,
    status: 'proposed',
    source: 'codex',
    body: `# Plan ${version}`,
    sourceRunId: null,
    sourceMessageId: null,
    approvedAt: null,
    approvedBy: null,
    approvedOption: null,
    approvedCommit: null,
    createdAt: '2026-10-11T03:56:00.000Z',
    ...overrides,
  };
}

const approved = {
  status: 'approved',
  source: 'claude_plan_mode',
  approvedAt: '2026-10-11T03:57:00.000Z',
  approvedBy: 'user',
} as const;

describe('the plan in the Work panel', () => {
  it('names a plan nobody approved as proposed, never as agreed', () => {
    render(<AgreedPlan plans={{ documents: [plan(1, {})], staleFiles: [] }} />);
    expect(screen.getByRole('region', { name: 'Proposed plan' }).textContent).toContain(
      'Codex plan',
    );
    expect(screen.queryByText('Agreed plan')).toBeNull();
    expect(screen.queryByText('Approved')).toBeNull();
  });

  it('names an approved plan as agreed, with a later proposal under older versions', () => {
    const documents = [plan(1, approved), plan(2, {})];
    render(<AgreedPlan plans={{ documents, staleFiles: [] }} />);
    const agreed = screen.getByRole('region', { name: 'Agreed plan' });
    expect(agreed.textContent).toContain('Approved');
    expect(agreed.textContent).toContain('v1');
    expect(screen.queryByText('Proposed plan')).toBeNull();
  });
});
