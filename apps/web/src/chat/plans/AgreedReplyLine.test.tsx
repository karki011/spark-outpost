// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationDetail, Message } from '@spark-outpost/contracts';
import { AgreedReplyLine } from './AgreedReplyLine.tsx';

afterEach(cleanup);

const PLAN = '## Plan\n1. Add `src/export.ts`\n2. Wire the button\n3. Test it';
const reply = { id: 'a-one', role: 'assistant', content: PLAN, runId: 'one' } as Message;

function detail(saved: { messageId: string; version: number }[]): ConversationDetail {
  return { plans: { saved, lines: [] } } as unknown as ConversationDetail;
}

describe('AgreedReplyLine', () => {
  it('shows no button and no line under a plan reply nobody agreed to', () => {
    const { container } = render(<AgreedReplyLine detail={detail([])} message={reply} finished />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Save as agreed plan/)).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('names the version under a reply that is an agreed plan, with nothing to click', () => {
    render(
      <AgreedReplyLine
        detail={detail([{ messageId: 'a-one', version: 2 }])}
        message={reply}
        finished
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Agreed plan v2');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('waits for the reply to finish', () => {
    render(
      <AgreedReplyLine
        detail={detail([{ messageId: 'a-one', version: 1 }])}
        message={reply}
        finished={false}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
