// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaCrumb } from './MapOverlays.tsx';
import { EDGES, PROJECT, SERVER, WEB, sampleDetail, sampleMap } from './map-samples.ts';
import { RunningChatsPanel } from './RunningChatsPanel.tsx';
import { runningMarks, type RunningChat } from './running-model.ts';
import { areaKey, buildScene } from './scene.ts';
import type { RunningOverlay } from './use-running-overlay.ts';

vi.mock('../brand/ProviderBlob.tsx', () => ({ ProviderBlob: () => null }));

afterEach(cleanup);

const input = [{ projectId: PROJECT, name: 'app', map: sampleMap(PROJECT, [WEB, SERVER]) }];
const scene = buildScene(input, new Map([[areaKey(PROJECT, WEB.id), sampleDetail(WEB, EDGES)]]));

const CHATS: RunningChat[] = [
  {
    id: 'ada',
    title: 'Fix tickets',
    status: 'running',
    projectId: PROJECT,
    paths: ['apps/web/src/tickets/Tickets.tsx', 'apps/web/src/tickets/ticket-model.ts'],
  },
  {
    id: 'ben',
    title: 'Server work',
    status: 'queued',
    projectId: PROJECT,
    paths: ['apps/server/src/tickets/routes.ts'],
  },
];

function overlay(extra: Partial<RunningOverlay> = {}): RunningOverlay {
  const marks = runningMarks(scene, CHATS, null);
  return {
    on: true,
    setOn: vi.fn(),
    chats: CHATS,
    count: CHATS.length,
    focused: null,
    setFocused: vi.fn(),
    marks,
    lit: { changed: marks.changed, dependents: new Set() },
    ...extra,
  };
}

describe('RunningChatsPanel', () => {
  it('names each chat with a status word and its file count', () => {
    render(
      <RunningChatsPanel overlay={overlay()} inset={0} onGoTo={() => {}} onOpenChat={() => {}} />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Running')).toBeTruthy();
    expect(within(rows[0]!).getByText('Fix tickets')).toBeTruthy();
    expect(within(rows[0]!).getByText('2 files')).toBeTruthy();
    expect(within(rows[1]!).getByText('Queued')).toBeTruthy();
    expect(within(rows[1]!).getByText('1 file')).toBeTruthy();
  });

  it('focuses a chat and goes to its first file, and releases the focus on a second press', () => {
    const state = overlay();
    const onGoTo = vi.fn();
    const { rerender } = render(
      <RunningChatsPanel overlay={state} inset={0} onGoTo={onGoTo} onOpenChat={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Queued/ }));
    expect(state.setFocused).toHaveBeenCalledWith('ben');
    expect(onGoTo).toHaveBeenCalledWith(PROJECT, 'apps/server/src/tickets/routes.ts');
    const focused = overlay({ focused: 'ben' });
    rerender(
      <RunningChatsPanel overlay={focused} inset={0} onGoTo={onGoTo} onOpenChat={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Queued/ }));
    expect(focused.setFocused).toHaveBeenCalledWith(null);
    expect(onGoTo).toHaveBeenCalledTimes(1);
  });

  it('opens a chat from its link', () => {
    const onOpenChat = vi.fn();
    render(
      <RunningChatsPanel overlay={overlay()} inset={0} onGoTo={() => {}} onOpenChat={onOpenChat} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open chat: Fix tickets/ }));
    expect(onOpenChat).toHaveBeenCalledWith('ada');
  });

  it('says so when nothing is running', () => {
    render(
      <RunningChatsPanel
        overlay={overlay({ chats: [], count: 0 })}
        inset={0}
        onGoTo={() => {}}
        onOpenChat={() => {}}
      />,
    );
    expect(screen.getByText('No chat is working in this project right now.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('AreaCrumb start a chat', () => {
  it('hands the project and area folder to the new-chat flow and does nothing else', () => {
    const onStartChat = vi.fn();
    const onBack = vi.fn();
    render(<AreaCrumb scene={scene} area={0} onBack={onBack} onStartChat={onStartChat} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in chat' }));
    expect(onStartChat).toHaveBeenCalledTimes(1);
    expect(onStartChat).toHaveBeenCalledWith(PROJECT, 'apps/web/src/tickets');
    expect(onBack).not.toHaveBeenCalled();
  });
});
