import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  isTerminalRunStatus,
  type ConversationDetail,
  type ConversationSummary,
  type Project,
  type UpdateConversationRequest,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { hasUnsentWork } from '../chat/composer/unsent-work.ts';
import { projectsApi } from '../api/projects.ts';
import { movedProjectIds } from './sidebar-groups.ts';
import { copyChatLink } from './use-copy-chat-link.tsx';
import { patchOlderChats } from './use-older-chats.ts';
import type { Toaster } from './use-toast.ts';

const SEARCH_ROOT = ['conversation-search'] as const;

type SummaryPatch = Partial<ConversationSummary>;

function patchSummaries(client: QueryClient, id: string, patch: SummaryPatch): void {
  const apply = (list: ConversationSummary[] | undefined) =>
    list?.map((chat) => (chat.id === id ? { ...chat, ...patch } : chat));
  client.setQueryData<ConversationSummary[]>(queryKeys.conversations, apply);
  patchOlderChats(client, apply);
  client.setQueriesData<ConversationSummary[]>({ queryKey: SEARCH_ROOT }, apply);
  client.setQueryData<ConversationDetail>(queryKeys.conversation(id), (detail) =>
    detail ? { ...detail, conversation: { ...detail.conversation, ...patch } } : detail,
  );
}

function dropSummary(client: QueryClient, id: string): void {
  const apply = (list: ConversationSummary[] | undefined) => list?.filter((chat) => chat.id !== id);
  client.setQueryData<ConversationSummary[]>(queryKeys.conversations, apply);
  patchOlderChats(client, apply);
  client.setQueriesData<ConversationSummary[]>({ queryKey: SEARCH_ROOT }, apply);
  client.removeQueries({ queryKey: queryKeys.conversation(id), exact: true });
}

async function refreshLists(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
    client.invalidateQueries({ queryKey: SEARCH_ROOT }),
  ]);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

interface ChatActionsOptions {
  toaster: Toaster;
  projects: readonly Project[];
  selectedId: string | null;
  nextChatId: (excluding: string) => string | null;
  onSelect: (id: string) => void;
  onNew: () => string;
}

export function useChatActions({
  toaster,
  projects,
  selectedId,
  nextChatId,
  onSelect,
  onNew,
}: ChatActionsOptions) {
  const client = useQueryClient();
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  const shownId = useRef(selectedId);

  useEffect(() => {
    shownId.current = selectedId;
  }, [selectedId]);

  const setDeletingId = (id: string, on: boolean) =>
    setDeleting((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const flash = (id: string) => {
    setFlashId(null);
    requestAnimationFrame(() => setFlashId(id));
  };

  const fail = (error: unknown, revert: () => void) => {
    revert();
    toaster.show({ text: message(error) });
    void refreshLists(client);
  };

  const update = async (
    chat: ConversationSummary,
    change: UpdateConversationRequest,
    optimistic: SummaryPatch,
  ): Promise<boolean> => {
    const before: SummaryPatch = Object.fromEntries(
      Object.keys(optimistic).map((key) => [key, chat[key as keyof ConversationSummary]]),
    );
    patchSummaries(client, chat.id, optimistic);
    try {
      const saved = await api.updateConversation(chat.id, change);
      patchSummaries(client, chat.id, saved);
      return true;
    } catch (error) {
      fail(error, () => patchSummaries(client, chat.id, before));
      return false;
    }
  };

  const projectName = (id: string | undefined) =>
    projects.find((project) => project.id === id)?.name ?? 'the project';

  const setProjects = async (chat: ConversationSummary, projectIds: string[]) => {
    const previous = chat.projectIds;
    patchSummaries(client, chat.id, { projectIds });
    flash(chat.id);
    try {
      await api.updateChatSettings(chat.id, { projectIds });
      void client.invalidateQueries({ queryKey: queryKeys.conversation(chat.id) });
      return true;
    } catch (error) {
      fail(error, () => patchSummaries(client, chat.id, { projectIds: previous }));
      return false;
    }
  };

  const move = async (chat: ConversationSummary, target: string | null): Promise<boolean> => {
    const previous = chat.projectIds;
    const next = movedProjectIds(previous, target);
    if (next.join() === previous.join()) return true;
    if (!(await setProjects(chat, next))) return false;
    toaster.show({
      text: target ? `Moved to ${projectName(target)}` : `Removed from ${projectName(previous[0])}`,
      undo: () => void setProjects({ ...chat, projectIds: next }, previous),
    });
    return true;
  };

  const saveProjectOrder = async (projectId: string, ids: readonly string[]) => {
    try {
      await projectsApi.orderChats(projectId, [...ids]);
    } catch (error) {
      toaster.show({ text: message(error) });
      void refreshLists(client);
    }
  };

  const reorderPinned = async (ids: readonly string[]) => {
    ids.forEach((id, index) => patchSummaries(client, id, { pinnedOrder: index + 1 }));
    try {
      await api.orderPinned([...ids]);
    } catch (error) {
      toaster.show({ text: message(error) });
      void refreshLists(client);
    }
  };

  const drop = async (
    chat: ConversationSummary,
    target: string | null,
    order: readonly string[] | null,
  ) => {
    const moving = (chat.projectIds[0] ?? null) !== target;
    if (order && chat.pinnedAt) void reorderPinned(order);
    const projectOrder = order && !chat.pinnedAt && target ? order : null;
    projectOrder?.forEach((id, index) => patchSummaries(client, id, { projectOrder: index + 1 }));
    if (moving && !(await move(chat, target))) return;
    if (target && projectOrder) await saveProjectOrder(target, projectOrder);
  };

  const archive = async (chat: ConversationSummary, archived: boolean) => {
    const stamp = archived ? new Date().toISOString() : null;
    const wasOpen = chat.id === shownId.current;
    if (!(await update(chat, { archived }, { archivedAt: stamp }))) return;
    if (!archived) {
      flash(chat.id);
      toaster.show({ text: `Restored ${chat.title} to Active` });
      return;
    }
    const newChatId = wasOpen ? onNew() : null;
    toaster.show({
      text: `Archived ${chat.title}`,
      undo: () => {
        flash(chat.id);
        void update({ ...chat, archivedAt: stamp }, { archived: false }, { archivedAt: null });
        const untouched = newChatId !== null && !hasUnsentWork(newChatId);
        if (untouched && shownId.current === newChatId) onSelect(chat.id);
      },
    });
  };

  const isBusy = (chat: ConversationSummary) => {
    const latest = client
      .getQueryData<ConversationSummary[]>(queryKeys.conversations)
      ?.find((item) => item.id === chat.id)?.latestRun;
    const run = latest === undefined ? chat.latestRun : latest;
    return run !== null && !isTerminalRunStatus(run.status);
  };

  const finishDelete = (chat: ConversationSummary) => {
    api.deleteConversation(chat.id).then(
      () => {
        dropSummary(client, chat.id);
        setDeletingId(chat.id, false);
      },
      (error: unknown) => {
        setDeletingId(chat.id, false);
        void refreshLists(client);
        toaster.show({
          text: `Could not delete ${chat.title}. ${message(error)}`,
          retry: () => {
            setDeletingId(chat.id, true);
            finishDelete(chat);
          },
        });
      },
    );
  };

  const remove = (chat: ConversationSummary) => {
    setDeletingId(chat.id, true);
    if (chat.id === selectedId) {
      const next = nextChatId(chat.id);
      if (next) onSelect(next);
      else onNew();
    }
    toaster.show({
      text: isBusy(chat) ? `Stopping and deleting ${chat.title}…` : `Deleted ${chat.title}`,
      undo: () => {
        setDeletingId(chat.id, false);
        flash(chat.id);
      },
      onSettle: () => finishDelete(chat),
    });
  };

  return {
    deleting,
    flashId,
    rename: (chat: ConversationSummary, title: string) =>
      void update(chat, { title }, { title, titleSource: 'user' }),
    setAutoTitle: (chat: ConversationSummary, on: boolean) =>
      void update(chat, { autoTitle: on }, { titleSource: on ? 'message' : 'user' }),
    pin: (chat: ConversationSummary) => {
      const pinned = chat.pinnedAt === null;
      flash(chat.id);
      void update(
        chat,
        { pinned },
        { pinnedAt: pinned ? new Date().toISOString() : null, pinnedOrder: null },
      ).then(() => refreshLists(client));
    },
    reorderPinned: (ids: readonly string[]) => void reorderPinned(ids),
    move: (chat: ConversationSummary, target: string | null) => void move(chat, target),
    drop: (chat: ConversationSummary, target: string | null, order: readonly string[] | null) =>
      void drop(chat, target, order),
    archive: (chat: ConversationSummary, archived: boolean) => void archive(chat, archived),
    copyLink: (chat: ConversationSummary) =>
      void copyChatLink(chat.id).then((text) => toaster.show({ text })),
    remove,
  };
}

export type ChatActions = ReturnType<typeof useChatActions>;
