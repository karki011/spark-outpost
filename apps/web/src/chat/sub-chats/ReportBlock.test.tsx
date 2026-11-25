// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NONE_STATED,
  REPORT_FOOTER,
  REPORT_FOR,
  type SubChatReport,
} from '@spark-outpost/contracts';
import { ReportBlock } from './ReportBlock.tsx';

afterEach(cleanup);

const SUB_CHAT = '22222222-2222-4222-8222-222222222222';

const REPORT: SubChatReport = {
  status: 'ready_for_review',
  reason: null,
  changed: 'New payments/v2 client, 14 files.',
  risks: 'Refund path is untested.',
  blockers: '',
  said: '',
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
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
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
    expect(block.textContent).toContain(REPORT_FOR);
  });

  it('starts folded to its header and unfolds from the Report button', () => {
    render(<ReportBlock from={from} report={REPORT} />);
    const toggle = screen.getByRole('button', { name: 'Report' });
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(screen.getByText('Ready for review')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    fireEvent.click(toggle);
    expect(body.hidden).toBe(true);
  });

  it('starts unfolded when the sub-chat needs you', () => {
    render(<ReportBlock from={from} report={{ ...REPORT, status: 'needs_you' }} />);
    expect(screen.getByRole('button', { name: 'Report' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('shows what else the agent said under the three sections', () => {
    const said = 'node --test passes: 1 test.\n\nVerification: ran it twice.';
    render(<ReportBlock from={from} report={{ ...REPORT, said }} />);
    const block = screen.getByRole('region', { name: 'Report from Payments API v2' });
    const terms = [...block.querySelectorAll('dt')].map((term) => term.textContent);
    expect(terms).toEqual(['Changed', 'Branch and pull request', 'Risks', 'Blockers', 'Also said']);
    expect(block.textContent).toContain('node --test passes: 1 test.');
    expect(block.textContent).toContain('Verification: ran it twice.');
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
    expect(screen.queryByRole('button', { name: 'Payments API v2' })).toBeNull();
  });
});
