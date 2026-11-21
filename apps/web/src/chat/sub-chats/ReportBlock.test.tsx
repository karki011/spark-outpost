// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NONE_STATED, REPORT_FOOTER, type SubChatReport } from '@spark-outpost/contracts';
import { ReportBlock } from './ReportBlock.tsx';

afterEach(cleanup);

const SUB_CHAT = '22222222-2222-4222-8222-222222222222';

const REPORT: SubChatReport = {
  status: 'ready_for_review',
  reason: null,
  changed: 'New payments/v2 client, 14 files.',
  risks: 'Refund path is untested.',
  blockers: '',
  branch: 'spark/payments-api-v2',
  committed: true,
  pushed: true,
  pullRequest: {
    number: 412,
    url: 'https://github.com/acme/shop/pull/412',
    state: 'open',
    checks: 'passing',
  },
};

const from = { id: SUB_CHAT, title: 'Payments API v2' };

describe('a sub-chat’s report', () => {
  it('shows the fixed fields, Spark’s own branch record and who wrote it', () => {
    render(<ReportBlock from={from} report={REPORT} />);
    const block = screen.getByRole('region', { name: 'Report from Payments API v2' });
    const terms = [...block.querySelectorAll('dt')].map((term) => term.textContent);
    expect(terms).toEqual(['Changed', 'Branch and pull request', 'Risks', 'Blockers']);
    expect(block.textContent).toContain('New payments/v2 client, 14 files.');
    expect(block.textContent).toContain(
      'spark/payments-api-v2 · committed · pushed · #412 · checks passing',
    );
    expect(within(block).getByRole('link', { name: 'Pull request 412' }).getAttribute('href')).toBe(
      REPORT.pullRequest!.url,
    );
    expect(block.textContent).toContain('Ready for review');
    expect(block.textContent).toContain(REPORT_FOOTER);
    expect(block.textContent).toContain('not your message');
  });

  it('reads “None stated” for a section the agent left out', () => {
    render(<ReportBlock from={from} report={{ ...REPORT, risks: '  ', blockers: '' }} />);
    const values = [...document.querySelectorAll('dd')].map((value) => value.textContent);
    expect(values.filter((value) => value === NONE_STATED)).toHaveLength(2);
  });

  it('says what happened when the turn failed, and what Spark has not recorded', () => {
    const failed: SubChatReport = {
      ...REPORT,
      status: 'needs_you',
      reason: 'Its turn was stopped.',
      branch: null,
      committed: false,
      pushed: false,
      pullRequest: null,
    };
    render(<ReportBlock from={from} report={failed} />);
    const block = screen.getByRole('region', { name: 'Report from Payments API v2' });
    expect(block.querySelector('dt')?.textContent).toBe('What happened');
    expect(block.textContent).toContain('Its turn was stopped.');
    expect(block.textContent).toContain('Needs you');
    expect(block.textContent).toContain(
      'No branch · not committed · not pushed · no pull request yet',
    );
  });

  it('opens the sub-chat from its name, and is plain text once that chat is gone', () => {
    const onOpenChat = vi.fn();
    const { rerender } = render(
      <ReportBlock from={from} report={REPORT} onOpenChat={onOpenChat} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Payments API v2' }));
    expect(onOpenChat).toHaveBeenCalledWith(SUB_CHAT);
    rerender(
      <ReportBlock
        from={{ id: null, title: 'Payments API v2' }}
        report={REPORT}
        onOpenChat={onOpenChat}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
