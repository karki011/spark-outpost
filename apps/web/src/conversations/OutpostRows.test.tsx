// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, Outpost, Project } from '@spark-outpost/contracts';
import { ChatMenu } from './ChatMenu.tsx';
import type { MemberChat } from './outpost-members.ts';
import { OutpostRows } from './OutpostRows.tsx';

afterEach(cleanup);

const ORDERS = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b101';
const USAGE = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b102';
const CHAT = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b103';
const PROJECT = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b104';

function outpost(id: string, name: string, needsYou: number, handles: string[] = []): Outpost {
  return {
    id,
    name,
    pausedAt: null,
    instructions: '',
    createdAt: '2026-10-09T10:00:00Z',
    updatedAt: '2026-10-09T10:00:00Z',
    members: handles.map((handle, position) => ({
      conversationId: crypto.randomUUID(),
      handle,
      position,
      joinedAt: '2026-10-09T10:00:00Z',
    })),
    needsYou,
  };
}

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: CHAT,
    title: 'Usage page',
    updatedAt: '2026-10-09T10:00:00Z',
    projectIds: [PROJECT],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...overrides,
  };
}

const projects = [{ id: PROJECT, name: 'web' }] as Project[];
const anchor = { x: 10, y: 10, above: 10, focusBack: null };

function renderMenu(options: { chat?: ConversationSummary; list?: Outpost[] | null } = {}) {
  const actions = { onAdd: vi.fn(), onNew: vi.fn() };
  const onClose = vi.fn();
  const list =
    options.list === undefined ? [outpost(ORDERS, 'Orders launch', 0, ['web'])] : options.list;
  render(
    <ChatMenu
      chat={options.chat ?? chat()}
      anchor={anchor}
      projects={projects}
      outposts={list ? { list, ...actions } : undefined}
      onClose={onClose}
      onRename={vi.fn()}
      onAutoTitle={vi.fn()}
      onPin={vi.fn()}
      onCopyLink={vi.fn()}
      onMove={vi.fn()}
      onArchive={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  return { ...actions, onClose };
}

type RowsProps = ComponentProps<typeof OutpostRows>;

function renderOutposts(props: Partial<RowsProps> & Pick<RowsProps, 'outposts'>) {
  return render(
    <OutpostRows
      members={new Map()}
      openId={null}
      isOpen={() => true}
      onToggle={vi.fn()}
      onOpen={vi.fn()}
      renderMembers={(_id, members: readonly MemberChat[]) => (
        <ul aria-label="Member chats">
          {members.map((member) => (
            <li key={member.chat.id}>
              {member.chat.title} @{member.handle}
            </li>
          ))}
        </ul>
      )}
      {...props}
    />,
  );
}

const PLAIN = { role: { kind: 'other' as const }, face: true };

describe('OutpostRows', () => {
  it('lists each outpost by name with its Needs you count as text', () => {
    renderOutposts({
      outposts: [outpost(ORDERS, 'Orders launch', 2), outpost(USAGE, 'Usage by user', 0)],
    });
    const section = within(screen.getByRole('region', { name: 'Outposts' }));
    expect(section.getAllByRole('listitem')).toHaveLength(2);
    expect(section.getByRole('button', { name: 'Orders launch, 2 need you' })).toBeTruthy();
    expect(section.getByRole('button', { name: 'Usage by user' })).toBeTruthy();
  });

  it('counts one request in the singular', () => {
    renderOutposts({ outposts: [outpost(ORDERS, 'Orders launch', 1)] });
    expect(screen.getByRole('button', { name: 'Orders launch, 1 needs you' })).toBeTruthy();
  });

  it('opens an outpost and marks the open one as current', () => {
    const onOpen = vi.fn();
    renderOutposts({
      outposts: [outpost(ORDERS, 'Orders launch', 0), outpost(USAGE, 'Usage by user', 0)],
      openId: USAGE,
      onOpen,
    });
    const open = screen.getByRole('button', { name: 'Usage by user' });
    expect(open.getAttribute('aria-current')).toBe('page');
    const other = screen.getByRole('button', { name: 'Orders launch' });
    expect(other.getAttribute('aria-current')).toBeNull();
    fireEvent.click(other);
    expect(onOpen).toHaveBeenCalledWith(ORDERS);
  });

  it('offers New outpost when there are none', () => {
    const onNew = vi.fn();
    renderOutposts({ outposts: [], onNew });
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New outpost' }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('has no New outpost where outposts cannot be created', () => {
    renderOutposts({ outposts: [] });
    expect(screen.getByText('Outposts')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New outpost' })).toBeNull();
  });

  it('lists the member chats of each outpost under it and nothing under one without chats', () => {
    const members = new Map([
      [
        ORDERS,
        [
          { chat: chat({ id: CHAT, title: 'Frontend' }), handle: 'fe', ...PLAIN },
          { chat: chat({ id: PROJECT, title: 'Orders API' }), handle: 'api', ...PLAIN },
        ],
      ],
    ]);
    renderOutposts({
      outposts: [outpost(ORDERS, 'Orders launch', 0), outpost(USAGE, 'Usage by user', 0)],
      members,
    });
    const listed = within(screen.getByRole('list', { name: 'Member chats' }));
    expect(listed.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Frontend @fe',
      'Orders API @api',
    ]);
    expect(screen.getAllByRole('button', { name: /chats? in / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Orders launch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usage by user' })).toBeTruthy();
  });

  it('asks whether each outpost is open and toggles the one whose arrow is pressed', () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    renderOutposts({
      outposts: [outpost(ORDERS, 'Orders launch', 0)],
      members: new Map([[ORDERS, [{ chat: chat(), handle: 'fe', ...PLAIN }]]]),
      isOpen: (id) => id !== ORDERS,
      onToggle,
      onOpen,
    });
    const fold = screen.getByRole('button', { name: '1 chat in Orders launch' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(onToggle).toHaveBeenCalledWith(ORDERS);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('Add to outpost in the chat menu', () => {
  it('is absent when outposts are not offered, so the menu is as before', () => {
    renderMenu({ list: null });
    expect(screen.queryByRole('menuitem', { name: 'Add to outpost' })).toBeNull();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rename',
      'Stop auto-renaming this chat',
      'Pin',
      'Move to project',
      'Copy chat link',
      'Archive',
      'Delete',
    ]);
  });

  it('is not offered to a member, an archived chat or a terminal session', () => {
    renderMenu({
      chat: chat({ outpost: { id: ORDERS, name: 'Orders launch', handle: 'fe', ...PLAIN } }),
    });
    expect(screen.queryByRole('menuitem', { name: 'Add to outpost' })).toBeNull();
    cleanup();
    renderMenu({ chat: chat({ archivedAt: '2026-10-09T10:00:00Z' }) });
    expect(screen.queryByRole('menuitem', { name: 'Add to outpost' })).toBeNull();
    cleanup();
    renderMenu({ chat: chat({ sessionType: 'terminal' }) });
    expect(screen.queryByRole('menuitem', { name: 'Add to outpost' })).toBeNull();
  });

  it('picks an outpost, suggests a free handle from the project and adds the chat', () => {
    const { onAdd, onClose } = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to outpost' }));
    expect(screen.getByRole('menu', { name: 'Add to outpost' })).toBeTruthy();
    const pick = screen.getByRole('menuitem', { name: /^Orders launch/ });
    expect(pick.textContent).toBe('Orders launch1 chat');
    fireEvent.click(pick);
    expect(screen.getByRole('menu', { name: 'Add to Orders launch' })).toBeTruthy();
    const handle = screen.getByRole('textbox', { name: 'Handle' });
    expect(handle).toHaveProperty('value', 'web2');
    expect(document.activeElement).toBe(handle);
    fireEvent.change(handle, { target: { value: '@Charts' } });
    expect(handle).toHaveProperty('value', 'charts');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to outpost' }));
    expect(onAdd).toHaveBeenCalledWith(ORDERS, 'charts');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses a handle that is taken and says why', () => {
    const { onAdd } = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to outpost' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Orders launch/ }));
    const handle = screen.getByRole('textbox');
    fireEvent.change(handle, { target: { value: 'web' } });
    expect(screen.getByRole('alert').textContent).toBe('@web is already used in this outpost.');
    expect(screen.getByRole('menuitem', { name: 'Add to outpost' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('adds with Enter and steps back with Escape without closing the menu', () => {
    const { onAdd, onClose } = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to outpost' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Orders launch/ }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.getByRole('menu', { name: 'Add to outpost' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Orders launch/ }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith(ORDERS, 'web2');
  });

  it('starts a new outpost from the list', () => {
    const { onNew, onClose } = renderMenu({ list: [] });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to outpost' }));
    expect(screen.getByText('No outposts yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New outpost' }));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
