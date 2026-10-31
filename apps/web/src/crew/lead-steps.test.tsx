// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { LeadStep } from '../chat/turn/live-label.ts';
import { useLeadSteps, useReportLeadStep } from './lead-steps.ts';

afterEach(cleanup);

function Reporter({ step }: { step: LeadStep | null }) {
  useReportLeadStep('run', step);
  return null;
}

function Reader() {
  const step = useLeadSteps().get('run');
  return <p>{step ? `${step.label} since ${step.since}` : 'none'}</p>;
}

it("shares a turn's live step with Agent TV until the turn stops reporting it", () => {
  const view = render(
    <>
      <Reporter step={{ label: 'Publishing', since: 5 }} />
      <Reader />
    </>,
  );
  expect(screen.getByText('Publishing since 5')).toBeTruthy();
  view.rerender(
    <>
      <Reporter step={null} />
      <Reader />
    </>,
  );
  expect(screen.getByText('none')).toBeTruthy();
});
