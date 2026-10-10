// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '@spark-outpost/contracts';
import { QueueStrip } from '../queue/QueueStrip.tsx';
import type { ChatQueue } from '../queue/use-chat-queue.ts';
import { OutpostChip } from './OutpostChip.tsx';
import { OutpostFaces } from '../../outposts/MemberFace.tsx';
import { API_CHAT, FE_CHAT, OUTPOST_ID, outpost } from '../../outposts/test-fixtures.ts';
import { RequestHeader, requestNote, requestSender, type RunOutpost } from './RequestHeader.tsx';
import { memberChatId } from './outpost-seam.ts';

afterEach(cleanup);

const POST_ID = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b001';

function request(from: Partial<RunOutpost>): RunOutpost {
  return {
    postId: POST_ID,
    outpostId: '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b002',
    outpostName: 'Orders launch',
    fromHandle: 'fe',
    fromUser: false,
    fromSpark: false,
    userStarted: false,
    ...from,
  };
}

function queued(id: string, outpostPostId: string | null): QueuedMessage {
  return {
    id,
    content: `message ${id}`,
    position: 1,
    continueRunId: null,
    createdAt: '2026-10-09T10:00:00Z',
    outpostPostId,
  };
}

function queueOf(items: QueuedMessage[]): ChatQueue {
  return {
    items,
    add: vi.fn(),
    edit: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    sendNow: vi.fn(),
    sendFirst: vi.fn(),
    error: null,
  };
}

describe('OutpostChip', () => {
  it('names the outpost and the handle and opens the outpost', () => {
    const onOpen = vi.fn();
    render(<OutpostChip name="Orders launch" handle="fe" onOpen={onOpen} />);
    const chip = screen.getByRole('button', {
      name: 'Open outpost Orders launch. This chat is @fe in Orders launch',
    });
    expect(chip.textContent).toBe('Orders launch@fe');
    expect(chip).toHaveProperty('type', 'button');
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('is plain text when there is nowhere to open', () => {
    render(<OutpostChip name="Orders launch" handle="fe" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle('This chat is @fe in Orders launch').textContent).toBe(
      'Orders launch@fe',
    );
  });
});

describe('RequestHeader', () => {
  it('says who sent the request', () => {
    expect(requestSender({ fromUser: false, fromHandle: 'fe' })).toBe('From @fe');
    expect(requestSender({ fromUser: true, fromHandle: null })).toBe('From you');
    expect(requestSender({ fromUser: true, fromHandle: 'fe' })).toBe('From you');
    expect(requestSender({ fromUser: false, fromHandle: null })).toBe('From another chat');
    expect(requestSender({ fromUser: false, fromHandle: null, fromSpark: true })).toBe(
      'From Spark',
    );
    expect(requestNote({ fromUser: false, fromHandle: null, fromSpark: true })).toBe(
      'not from you',
    );
  });

  it('says a request another chat wrote is not the user’s, and a draft task was only started by them', () => {
    expect(requestNote({ fromUser: true, fromHandle: null })).toBeNull();
    expect(requestNote({ fromUser: false, fromHandle: 'fe' })).toBe('not from you');
    const task = { fromUser: false, fromHandle: 'lead', userStarted: true };
    expect(requestSender(task)).toBe('Task from @lead');
    expect(requestSender({ ...task, fromHandle: null })).toBe('Task from another chat');
    expect(requestNote(task)).toBe('started by you, not written by you');
    expect(requestSender({ fromUser: true, fromHandle: null, userStarted: true })).toBe('From you');
  });

  it('heads a story’s first message with the chat that proposed it', () => {
    render(
      <RequestHeader outpost={request({ fromHandle: 'lead', userStarted: true })}>
        Build the form
      </RequestHeader>,
    );
    expect(screen.getByText('Task from @lead').parentElement?.textContent).toBe(
      'Task from @leadstarted by you, not written by youin Orders launch',
    );
  });

  it('heads the request with its sender and outpost above the text', () => {
    render(<RequestHeader outpost={request({})}>What shape is the response?</RequestHeader>);
    expect(screen.getByText('From @fe').parentElement?.textContent).toBe(
      'From @fenot from youin Orders launch',
    );
    expect(screen.getByText('What shape is the response?')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('heads a request the user typed in the outpost as theirs', () => {
    render(
      <RequestHeader outpost={request({ fromUser: true, fromHandle: null })}>Go</RequestHeader>,
    );
    expect(screen.getByText('From you').parentElement?.textContent).toBe(
      'From youin Orders launch',
    );
  });

  it('draws the asking chat its blob, and none for the user or an unknown chat', () => {
    const chatId = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b003';
    const { container, rerender } = render(
      <RequestHeader outpost={request({})} fromChatId={chatId}>
        Text
      </RequestHeader>,
    );
    expect(container.querySelector('.chat-face')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<RequestHeader outpost={request({})}>Text</RequestHeader>);
    expect(container.querySelector('.chat-face')).toBeNull();
    rerender(
      <RequestHeader outpost={request({ fromUser: true })} fromChatId={chatId}>
        Text
      </RequestHeader>,
    );
    expect(container.querySelector('.chat-face')).toBeNull();
  });

  it('draws the asking chat as its outpost shows it when two members share a colour', () => {
    const clashing = '0c000000-0000-4000-8000-000000000009';
    const members = [
      { conversationId: FE_CHAT, joinedAt: '2026-10-09T10:00:00.000Z' },
      { conversationId: clashing, joinedAt: '2026-10-09T10:05:00.000Z' },
    ];
    const { container } = render(
      <OutpostFaces members={members}>
        <RequestHeader outpost={request({})} fromChatId={clashing}>
          Text
        </RequestHeader>
      </OutpostFaces>,
    );
    expect(container.querySelector<HTMLElement>('.chat-face')?.dataset.color).toBe('ember');
  });

  it('finds the asking chat from its handle in the outpost', () => {
    const outposts = [outpost()];
    expect(memberChatId(outposts, OUTPOST_ID, 'api')).toBe(API_CHAT);
    expect(memberChatId(outposts, OUTPOST_ID, 'gone')).toBeNull();
    expect(memberChatId(outposts, OUTPOST_ID, null)).toBeNull();
    expect(memberChatId([], OUTPOST_ID, 'api')).toBeNull();
  });

  it('opens the outpost from the header', () => {
    const onOpen = vi.fn();
    render(
      <RequestHeader outpost={request({})} onOpen={onOpen}>
        Text
      </RequestHeader>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open in outpost' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('QueueStrip with an outpost request', () => {
  it('lets the request be moved, sent and removed but not edited', () => {
    const queue = queueOf([queued('a', null), queued('b', POST_ID)]);
    render(<QueueStrip queue={queue} mode="waiting" />);
    const own = within(screen.getByRole('listitem', { name: 'Queued message 1' }));
    const fromOutpost = within(screen.getByRole('listitem', { name: 'Queued message 2' }));
    expect(own.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(own.queryByText(/Outpost request/)).toBeNull();
    expect(fromOutpost.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(fromOutpost.getByText(/Outpost request/)).toBeTruthy();
    expect(fromOutpost.getByRole('button', { name: 'Move up' })).toBeTruthy();
    expect(fromOutpost.getByRole('button', { name: 'Send now' })).toBeTruthy();
    fireEvent.click(fromOutpost.getByRole('button', { name: 'Remove' }));
    expect(queue.remove).toHaveBeenCalledWith('b');
  });

  it('shows why the server refused to send a request now', () => {
    const refusal = 'A request from an outpost starts when this chat is free.';
    const queue = { ...queueOf([queued('b', POST_ID)]), error: refusal };
    render(<QueueStrip queue={queue} mode="waiting" />);
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(queue.sendNow).toHaveBeenCalledWith('b');
    expect(screen.getByRole('alert').textContent).toBe(refusal);
  });
});
