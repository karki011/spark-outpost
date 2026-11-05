import '../ui/panel-motion.css';
import './sidebar.css';
import './sidebar-chrome.css';
import './chat-row.css';
import './chat-menu.css';
import './sidebar-layout.css';
import { memo, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary, Outpost, Project } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { useOutpostSeam } from '../chat/outpost/outpost-seam.ts';
import { projectKeys } from '../api/projects.ts';
import { isConnectionLoss } from '../app/connection/connection-failure.ts';
import { useAddFolder } from '../projects/use-add-folder.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import {
  isFiltering,
  matchesFilter,
  matchesTeammate,
  parseChatFilter,
} from '../categories/category-filter.ts';
import { useDebouncedValue } from '../ui/use-debounced-value.ts';
import { scrollToChatApproval } from '../crew/scroll-to-anchor.ts';
import { AttentionCard } from './AttentionCard.tsx';
import { ActiveChats } from './ActiveChats.tsx';
import { ChatRowMenu } from './ChatRowMenu.tsx';
import { anchorFor, type OpenMenu, type OpenProjectMenu } from './menu-anchor.ts';
import { ChatRow } from './ChatRow.tsx';
import { ChatRows } from './ChatRows.tsx';
import { SidebarDndContext } from './SidebarDnd.tsx';
import { HistoryChats } from './HistoryChats.tsx';
import { OlderChatsMore } from './OlderChatsMore.tsx';
import { useOlderChats } from './use-older-chats.ts';
import { ProjectMenu } from './ProjectMenu.tsx';
import {
  membersByOutpost,
  memberships,
  outsideOutposts,
  type MemberChat,
} from './outpost-members.ts';
import { roleLine } from '../outposts/member-roles.ts';
import { attention } from './row-state.ts';
import { useAlertingChats } from '../attention/use-attention.ts';
import { activeGroups, mergedOrder, projectsWithChats } from './sidebar-groups.ts';
import { NO_PROJECT, chatLayout, groupOf, listIn, pinnedIn } from './sidebar-order.ts';
import {
  LIST_PANEL_ID,
  NewChatButton,
  SEARCH_DELAY_MS,
  SearchBox,
  SessionsButton,
  SidebarTabs,
  type SidebarTab,
} from './SidebarHeader.tsx';
import { SidebarCollapseButton, useSidebarLayout } from './sidebar-layout.tsx';
import { SidebarResizer } from './SidebarResizer.tsx';
import { TeammateFilter } from './TeammateFilter.tsx';
import { ToastHost } from './Toast.tsx';
import { useChatActions } from './use-chat-actions.ts';
import { useProjectActions } from './use-project-actions.ts';
import { useRowFocus } from './use-row-focus.ts';
import { useSidebarDnd, type Point } from './use-sidebar-dnd.ts';
import { useSidebarFolds } from './use-sidebar-folds.ts';
import { useSidebarShortcuts } from './use-sidebar-shortcuts.ts';
import { useToast } from './use-toast.ts';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { requestMessageJump } from '../chat/message-jump.ts';
import { queuePaneUrl } from '../browser/pending-pane-url.ts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';

const HOVER_OPEN_MS = 550;
const NO_OUTPOSTS: readonly Outpost[] = [];

interface ConversationListProps {
  selectedIds: readonly string[];
  onSelect: (id: string) => void;
  onOpenBeside: ((id: string) => void) | null;
  onLeave: (id: string) => boolean;
  onNew: () => string;
  onNewInProject: (projectId: string) => void;
}

export const ConversationList = memo(function ConversationList({
  selectedIds,
  onSelect,
  onOpenBeside,
  onLeave,
  onNew,
  onNewInProject,
}: ConversationListProps) {
  const client = useQueryClient();
  const selectedId = selectedIds[0] ?? null;
  const layout = useSidebarLayout();
  const outpostSeam = useOutpostSeam();
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const [tab, setTab] = useState<SidebarTab>('active');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const filter = parseChatFilter(deferredSearch);
  const query = useDebouncedValue(filter.text, SEARCH_DELAY_MS);
  const results = useQuery({
    queryKey: queryKeys.conversationSearch(query),
    queryFn: ({ signal }) => api.searchConversations(query, signal),
    enabled: query !== '',
    placeholderData: keepPreviousData,
  });
  const toaster = useToast();
  const folds = useSidebarFolds();
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [projectMenu, setProjectMenu] = useState<OpenProjectMenu | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const projectActions = useProjectActions(toaster, folds.open);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const older = useOlderChats(conversations.data);
  const all = older.chats;
  const alerting = useAlertingChats();
  const actions = useChatActions({
    toaster,
    projects: projectList,
    selectedId,
    nextChatId: (excluding) =>
      all.find(
        (chat) => chat.id !== excluding && !chat.archivedAt && !actions.deleting.has(chat.id),
      )?.id ?? null,
    onSelect,
    onNew,
    onLeave,
  });
  const present = (chat: ConversationSummary) => !actions.deleting.has(chat.id);
  const chats = all.filter(present);
  const searching = query !== '' || isFiltering(filter);
  const found = query !== '' ? (results.data ?? []).filter(present) : chats;
  const visible = found.filter(
    (chat) => matchesFilter(filter, chat.category) && matchesTeammate(filter, chat.teammate),
  );
  const byId = new Map([...chats, ...visible].map((chat) => [chat.id, chat]));
  const activeCount = chats.filter((chat) => !chat.archivedAt).length;
  const waiting = attention(chats, selectedIds, alerting);

  const projectAdded = async (project: Project) => {
    folds.open(project.id);
    toaster.show({ text: `Added project ${project.name}. Start a chat in it.` });
    onNewInProject(project.id);
    await client.invalidateQueries({ queryKey: projectKeys.all });
  };
  const moveTarget = useRef<ConversationSummary | null>(null);
  const adder = useAddFolder({
    onAdded: (project) => {
      const chat = moveTarget.current;
      moveTarget.current = null;
      if (chat) actions.move(chat, project.id);
      else void projectAdded(project);
    },
  });
  const moveActions = (chat: ConversationSummary) =>
    adder.actions.map((action) => ({
      ...action,
      onSelect: () => {
        moveTarget.current = chat;
        action.onSelect();
      },
    }));

  const openChat = (id: string) => {
    onSelect(id);
    layout?.closeDrawer();
  };

  const membership = memberships(outpostSeam?.outposts ?? NO_OUTPOSTS);
  const grouped = activeGroups(outsideOutposts(visible, membership), projectList);
  useRowFocus(
    listRef,
    [...membership].map(([chatId, member]) => `${chatId}:${member.outpostId}`).join(),
  );
  const projectById = new Map(projectList.map((project) => [project.id, project]));
  const allProjectIds = projectList.map((project) => project.id);
  const withChats = projectsWithChats(
    activeGroups(outsideOutposts(chats, membership), projectList).groups,
  );
  const dnd = useSidebarDnd({
    layout: chatLayout(grouped),
    projectIds: allProjectIds.filter((id) => withChats.has(id)),
    chatTitle: (id) => byId.get(id)?.title ?? 'Chat',
    updatedAt: (id) => byId.get(id)?.updatedAt ?? '',
    projectName: (id) => projectById.get(id)?.name ?? 'the project',
    onChatDrop: (drop) => {
      const chat = byId.get(drop.chatId);
      const group = groupOf(drop.to);
      if (chat) actions.drop(chat, group === NO_PROJECT ? null : group, drop.order);
    },
    onProjectsDrop: (shown) => projectActions.reorder(mergedOrder(allProjectIds, shown)),
    onHold: (chatId, point) => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-chat="${chatId}"]`);
      if (row) setMenu({ chatId, anchor: anchorFor(row, point) });
    },
  });
  const over = dnd.overGroup;
  const overFolded = over !== null && over !== NO_PROJECT && !folds.isOpen(over);
  const openFold = folds.open;
  const canDrag = tab === 'active' && !searching;

  useEffect(() => {
    if (!over || !overFolded) return;
    const timer = setTimeout(() => openFold(over), HOVER_OPEN_MS);
    return () => clearTimeout(timer);
  }, [over, overFolded, openFold]);

  const reveal = layout?.reveal;
  const closeDrawer = layout?.closeDrawer;
  const startNew = useCallback(() => {
    onNew();
    closeDrawer?.();
  }, [onNew, closeDrawer]);
  useSidebarShortcuts({ reveal, startNew, searchRef });

  const focusBack = menu?.anchor.focusBack ?? null;
  const closeMenu = useCallback(() => {
    setMenu(null);
    focusBack?.focus();
  }, [focusBack]);

  const projectFocusBack = projectMenu?.anchor.focusBack ?? null;
  const closeProjectMenu = useCallback(() => {
    setProjectMenu(null);
    projectFocusBack?.focus();
  }, [projectFocusBack]);

  const changeTab = (next: SidebarTab) => {
    setTab(next);
    setRenamingId(null);
  };

  const handleOpen = useStableCallback((id: string) => {
    const chat = byId.get(id);
    if (query !== '' && chat?.match && chat.sessionType !== 'terminal') {
      requestMessageJump(id, chat.match);
    }
    openChat(id);
  });
  const { remote } = useRemoteClient();
  const portsShown = desktopBrowser() !== null && !remote;
  const handleOpenPort = useStableCallback((id: string, url: string) => {
    queuePaneUrl(id, url);
    handleOpen(id);
  });
  const handleOpenBeside = useStableCallback((id: string) => {
    onOpenBeside?.(id);
    layout?.closeDrawer();
  });
  const handleMenu = useStableCallback(
    (chatId: string, element: HTMLElement, point: Point | null) =>
      setMenu({ chatId, anchor: anchorFor(element, point) }),
  );
  const handleRename = useStableCallback((chat: ConversationSummary, title: string | null) => {
    setRenamingId(null);
    if (title) actions.rename(chat, title);
  });
  const prepareChat = useStableCallback((id: string) => {
    void client.prefetchQuery({
      queryKey: queryKeys.conversation(id),
      queryFn: () => api.getConversation(id),
      staleTime: 5_000,
    });
  });
  const handleRestore = useStableCallback((chat: ConversationSummary) =>
    actions.archive(chat, false),
  );
  const handleDelete = useStableCallback((chat: ConversationSummary) => actions.remove(chat));

  const renderRow = (
    chat: ConversationSummary,
    sortable: boolean,
    index: number,
    member?: MemberChat,
  ) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      selected={selectedIds.includes(chat.id)}
      renaming={chat.id === renamingId}
      sortable={sortable}
      settling={dnd.busy}
      flash={chat.id === actions.flashId}
      index={index}
      handle={member?.handle}
      faceless={member ? !member.face : false}
      relation={member ? roleLine(member.role) : null}
      onOpen={handleOpen}
      onOpenBeside={onOpenBeside ? handleOpenBeside : undefined}
      onPrepare={prepareChat}
      onOpenPort={portsShown ? handleOpenPort : undefined}
      onMenu={handleMenu}
      onRename={handleRename}
      onRestore={handleRestore}
      onDelete={handleDelete}
    />
  );

  const rowsIn = (container: string) =>
    (dnd.layout[container] ?? []).flatMap((id) => {
      const chat = byId.get(id);
      return chat ? [chat] : [];
    });

  const renderRows = (
    id: string,
    rows: readonly ConversationSummary[],
    { sortable, enabled }: { sortable: boolean; enabled: boolean },
  ) => (
    <ChatRows
      key={id}
      id={id}
      chats={rows}
      sortable={sortable}
      renderRow={(chat, index) => renderRow(chat, canDrag && enabled, index)}
    />
  );

  const activeChat = dnd.active?.type === 'chat' ? (byId.get(dnd.active.chatId) ?? null) : null;
  const draggedProject =
    dnd.active?.type === 'project' ? projectById.get(dnd.active.projectId) : undefined;
  const activeProject = draggedProject
    ? {
        project: draggedProject,
        count:
          rowsIn(pinnedIn(draggedProject.id)).length + rowsIn(listIn(draggedProject.id)).length,
      }
    : null;
  const menuChat = menu ? byId.get(menu.chatId) : undefined;
  const menuProject = projectList.find((project) => project.id === projectMenu?.projectId);

  return (
    <nav className="side" aria-label="Chats" inert={layout?.hidden}>
      <div className="side-in">
        <div className="side-top">
          <b>Chats</b>
          <SessionsButton />
          <SidebarCollapseButton />
        </div>
        <NewChatButton onNew={startNew} />
        <SearchBox value={search} inputRef={searchRef} onChange={setSearch} />
        <TeammateFilter search={search} onSearch={setSearch} />
        <SidebarTabs
          tab={tab}
          activeCount={activeCount}
          historyCount={chats.length - activeCount}
          activeNeedsInput={waiting.count > 0}
          onTab={changeTab}
        />
        <AttentionCard
          waiting={waiting}
          onJump={(chat) => {
            changeTab('active');
            openChat(chat.id);
            scrollToChatApproval(chat);
          }}
        />
        {conversations.isError && !isConnectionLoss(conversations.error) && (
          <p className="side-note" role="alert">
            {conversations.error.message}
          </p>
        )}
        <SidebarDndContext dnd={dnd} chat={activeChat} project={activeProject}>
          <div
            ref={listRef}
            id={LIST_PANEL_ID}
            role="tabpanel"
            aria-label={tab === 'active' ? 'Active chats' : 'Archived chats'}
            className={`list${dnd.active ? ' dragging' : ''}`}
            data-projection={dnd.shift ?? undefined}
            aria-busy={searching && results.isFetching}
          >
            <div key={tab} className="list-in">
              {tab === 'active' ? (
                <ActiveChats
                  search={search}
                  searching={searching}
                  canDrag={canDrag}
                  hasChats={chats.length > 0}
                  projectById={projectById}
                  dnd={dnd}
                  folds={folds}
                  renamingProjectId={renamingProjectId}
                  rowsIn={rowsIn}
                  renderRows={renderRows}
                  renderRow={renderRow}
                  members={membersByOutpost(visible, membership)}
                  canAddProject={adder.allowed}
                  onAddProject={() => {
                    moveTarget.current = null;
                    adder.openDialog();
                  }}
                  onNewInProject={onNewInProject}
                  onProjectMenu={(projectId, element) =>
                    setProjectMenu({ projectId, anchor: anchorFor(element, null) })
                  }
                  onProjectRename={(project, name) => {
                    setRenamingProjectId(null);
                    if (name) projectActions.rename(project, name);
                  }}
                />
              ) : (
                <HistoryChats
                  chats={visible}
                  search={searching ? search.trim() : null}
                  folds={folds}
                  renderRow={renderRow}
                />
              )}
              {older.hasMore && !searching && (
                <OlderChatsMore loading={older.loading} failed={older.failed} onMore={older.more} />
              )}
            </div>
          </div>
        </SidebarDndContext>
        <ToastHost toaster={toaster} />
      </div>
      <SidebarResizer />
      {menu && menuChat && (
        <ChatRowMenu
          chat={menuChat}
          anchor={menu.anchor}
          chats={outsideOutposts(chats, membership)}
          projects={projectList}
          actions={actions}
          toaster={toaster}
          folderActions={moveActions(menuChat)}
          onClose={closeMenu}
          onRename={() => setRenamingId(menuChat.id)}
          onOpenBeside={
            onOpenBeside && !menuChat.archivedAt && !selectedIds.includes(menuChat.id)
              ? () => handleOpenBeside(menuChat.id)
              : null
          }
        />
      )}
      {projectMenu && menuProject && (
        <ProjectMenu
          project={menuProject}
          anchor={projectMenu.anchor}
          onClose={closeProjectMenu}
          onNewChat={() => onNewInProject(menuProject.id)}
          onRename={() => setRenamingProjectId(menuProject.id)}
          onRemove={() => projectActions.remove(menuProject)}
        />
      )}
      {adder.flow}
    </nav>
  );
});
