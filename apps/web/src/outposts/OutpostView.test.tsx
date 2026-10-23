// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, queryKeys } from '../api/client.ts';
import { phoneKeys } from '../phone/phone-api.ts';
import { SENT, calls, client, show, setUpOutpostView, view } from './outpost-view-harness.tsx';
import {
  API_CHAT,
  FE_CHAT,
  OUTPOST_ID,
  chat,
  detail,
  note,
  notice,
  post,
} from './test-fixtures.ts';
import { stackedStory } from './story-fixtures.ts';

setUpOutpostView();

describe('OutpostView', () => {
  it('shows the name, the chats, the thread and one message box', () => {
    show(
      detail([
        notice(1, '@api joined · api · Codex GPT-5 · Approve for me'),
        post(2, { state: 'working' }),
        note(3),
      ]),
    );
    view();
    expect(screen.getByRole('heading', { level: 1, name: 'Usage by user' })).toBeTruthy();
    expect(screen.queryByText(/^You and \d+ chats$/)).toBeNull();
    expect(within(screen.getByRole('toolbar')).getAllByRole('button')).toHaveLength(2);
    expect(
      within(screen.getByRole('list', { name: 'Outpost thread' })).getAllByRole('listitem'),
    ).toHaveLength(3);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('opens a chat from the strip and from a request’s thread', () => {
    show(detail([post(1)]));
    const onOpenChat = vi.fn<(id: string) => void>();
    view(onOpenChat);
    fireEvent.click(within(screen.getByRole('toolbar')).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Open the thread with @api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open @api in chat' }));
    expect(onOpenChat.mock.calls).toEqual([[FE_CHAT], [API_CHAT]]);
  });

  it('posts a request from the message box and shows it at once', async () => {
    show(detail());
    view();
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: '@api add the filter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const thread = screen.getByRole('list', { name: 'Outpost thread' });
    expect(await within(thread).findAllByText('add the filter')).not.toHaveLength(0);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/outposts/${OUTPOST_ID}/posts`,
      body: { text: '@api add the filter' },
    });
  });

  it('answers a Needs you in the main box, as a message to that chat', async () => {
    const sendMessage = vi.spyOn(api, 'sendMessage').mockResolvedValue(SENT);
    show(detail([post(1, { state: 'needs_you', reason: 'Light or dark theme?' })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Answer @api' }));
    expect(screen.getByText('Answering').textContent).toBe('Answering @api');
    const box = screen.getByRole('combobox');
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'Light.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]?.[0]).toBe(API_CHAT);
    expect(sendMessage.mock.calls[0]?.[2]).toBe('Light.');
    expect(calls).toEqual([]);
    await waitFor(() => expect(screen.queryByText('Answering')).toBeNull());
  });

  it('offers only Open in chat while the chat waits on an approval card', () => {
    client.setQueryData(queryKeys.conversations, [
      chat(FE_CHAT, { title: 'Usage page' }),
      chat(API_CHAT, {
        title: 'Usage endpoint',
        latestRun: {
          id: '0e000000-0000-4000-8000-000000000001',
          status: 'awaiting_approval',
          error: null,
          step: null,
          provider: null,
          progress: null,
        },
      }),
    ]);
    show(
      detail([
        post(1, { state: 'needs_you', reason: '@api is waiting for your approval' }),
        post(2, {
          state: 'needs_you',
          reason: 'Light or dark theme?',
          toConversationId: FE_CHAT,
          toHandle: 'fe',
        }),
      ]),
    );
    view();
    expect(screen.getByText('@api is waiting for your approval')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Answer @/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open the thread with @api' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Answer @fe' }));
    expect(screen.getByText('Answering').textContent).toBe('Answering @fe');
  });

  it('stops answering when the request is no longer waiting for the user', async () => {
    show(detail([post(1, { state: 'needs_you' })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Answer @api' }));
    expect(screen.getByText('Answering')).toBeTruthy();
    show(detail([post(1, { state: 'working' })]));
    await waitFor(() => expect(screen.queryByText('Answering')).toBeNull());
    expect(screen.getByRole('button', { name: 'Post note' })).toBeTruthy();
  });

  it('cancels a request and pauses the outpost', async () => {
    show(detail([post(1, { state: 'working' })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Stop the request to @api…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST /api/outposts/${OUTPOST_ID}/posts/${post(1).id}/cancel`,
      `PATCH /api/outposts/${OUTPOST_ID}`,
    ]);
    expect(calls[1]?.body).toEqual({ paused: true });
  });

  it('starts a request that waits for another chat when asked to', async () => {
    show(detail([post(1, { reason: 'Waiting for @fe', held: true })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Start the request to @api anyway' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(`${calls[0]?.method} ${calls[0]?.path}`).toBe(
      `POST /api/outposts/${OUTPOST_ID}/posts/${post(1).id}/start-now`,
    );
  });

  it('shows no story bar for an outpost without a story', () => {
    show(detail([post(1)]));
    view();
    expect(screen.queryByRole('region', { name: 'Stories' })).toBeNull();
  });

  it('lists a story under the chats and hands a stack update to the message box', () => {
    show({ ...detail([post(1)]), stories: [stackedStory()] });
    const onOpenChat = vi.fn<(id: string) => void>();
    view(onOpenChat);
    const stories = screen.getByRole('region', { name: 'Stories' });
    expect(within(stories).getByText('1 of 2 answered · 2 PRs · 2 warnings')).toBeTruthy();
    fireEvent.click(within(stories).getByRole('button', { name: 'Open @fe in chat' }));
    expect(onOpenChat).toHaveBeenCalledWith(FE_CHAT);

    fireEvent.click(within(stories).getByRole('button', { name: 'Update from @api' }));
    const box = screen.getByRole<HTMLTextAreaElement>('combobox');
    expect(box.value).toBe(
      '@fe merge spark/api-1 into your branch, fix any conflicts and run the checks.',
    );
    expect(document.activeElement).toBe(box);
    expect(calls).toEqual([]);
  });

  it('says it is paused and offers Resume', () => {
    show(detail([], { pausedAt: '2026-10-09T10:30:00.000Z' }));
    view();
    expect(screen.getByRole('button', { name: 'Resume' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('status').textContent).toContain('Paused.');
  });

  it('invites adding chats to an outpost with none, through the edit sheet', () => {
    show(detail([], { members: [] }));
    view();
    expect(screen.getByText('No chats here yet')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add chats' }));
    expect(screen.getByRole('dialog', { name: 'Edit outpost' })).toBeTruthy();
  });

  it('on a paired phone renames only: no chats to add, no handles, no delete', () => {
    client.setQueryData(phoneKeys.session, { remote: true, device: null, address: null });
    show(detail([], { members: [] }));
    view();
    expect(screen.getByText('Chats are added on your Mac.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add chats' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Usage by user' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit outpost' }));
    expect(dialog.getAllByRole('textbox')).toHaveLength(1);
    expect(dialog.queryByRole('button', { name: /Hold to delete outpost/ })).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Add a chat' })).toBeNull();
  });

  it('says so when the outpost was deleted and offers the way back', async () => {
    const onGone = vi.fn<() => void>();
    view(vi.fn<(id: string) => void>(), onGone);
    expect(await screen.findByText('This outpost was deleted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(onGone).toHaveBeenCalledTimes(1);
  });
});
