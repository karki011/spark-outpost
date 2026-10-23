import { within } from '@testing-library/react';
import type { Approval } from '@spark-outpost/contracts';

export const approval: Approval = {
  id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  toolCallId: 'call_1',
  kind: 'execute',
  title: 'pnpm test',
  payload: { command: 'pnpm test', cwd: '/work', paths: [], diffs: [], truncated: false },
  payloadHash: 'sha256:abc',
  options: [
    { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
    { optionId: 'no', name: 'No', kind: 'reject_once' },
  ],
  status: 'pending',
  reason: null,
  decisionOptionId: null,
  scope: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-26T10:00:00.000Z',
};

export function buttonNames(card: HTMLElement): string[] {
  return within(card)
    .getAllByRole('button')
    .map((button) =>
      [...button.childNodes]
        .filter((node) => !(node instanceof HTMLElement && node.classList.contains('keys')))
        .map((node) => node.textContent)
        .join(''),
    );
}
