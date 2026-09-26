import '../ui/panel-motion.css';
import './sidebar.css';
import './sidebar-chrome.css';
import './chat-row.css';
import './chat-menu.css';
import './sidebar-layout.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { SortableContext } from '@dnd-kit/sortable';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { isConnectionLoss } from '../app/connection/connection-failure.ts';
import { FolderDialog } from '../chat/project/FolderDialog.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { PlusIcon } from '../ui/icons.tsx';
import { isFiltering, matchesFilter, parseChatFilter } from '../categories/category-filter.ts';
import { useDebouncedValue } from '../ui/use-debounced-value.ts';
import { approvalAnchor } from '../crew/conversation-crew.ts';
import { scrollToAnchor } from '../crew/scroll-to-anchor.ts';
import { AttentionCard } from './AttentionCard.tsx';
import { ChatMenu } from './ChatMenu.tsx';
import type { MenuAnchor } from './MenuShell.tsx';
import { ChatRow } from './ChatRow.tsx';
import { ChatRows } from './ChatRows.tsx';
import { SidebarDndContext } from './SidebarDnd.tsx';
import { FoldSection } from './FoldSection.tsx';
import { LooseChats } from './LooseChats.tsx';
import { ProjectGroup } from './ProjectGroup.tsx';
import { ProjectMenu } from './ProjectMenu.tsx';
import { attention, isRunning, needsInput } from './row-state.ts';
import { activeGroups, historyGroups, movedOrder, pinnedSiblings } from './sidebar-groups.ts';
import { NO_PROJECT, chatLayout, groupOf, listIn, pinnedIn, LOOSE } from './sidebar-order.ts';
import {
  isNewChatShortcut,
  LIST_PANEL_ID,
  NewChatButton,
  SearchBox,
  SidebarTabs,
  type SidebarTab,
} from './SidebarHeader.tsx';
import { SidebarCollapseButton, useSidebarLayout } from './sidebar-layout.tsx';
import { SidebarResizer } from './SidebarResizer.tsx';
import { ToastHost } from './Toast.tsx';
import { useChatActions } from './use-chat-actions.ts';
import { useProjectActions } from './use-project-actions.ts';
import { useSidebarDnd, type Point } from './use-sidebar-dnd.ts';
import { useSidebarFolds } from './use-sidebar-folds.ts';
import { projectDragId } from './sidebar-dnd-geometry.ts';
import { useToast } from './use-toast.ts';

const SEARCH_DELAY_MS = 180;
const HOVER_OPEN_MS = 550;
const POLL_MS = 2000;
const JUMP_TRIES = 180;

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewInProject: (projectId: string) => void;
}

interface OpenMenu {
  chatId: string;
  anchor: MenuAnchor;
}

interface OpenProjectMenu {
  projectId: string;
  anchor: MenuAnchor;
}

function anchorFor(element: HTMLElement, point: Point | null): MenuAnchor {
  const rect = element.getBoundingClientRect();
  if (point) return { x: point.x, y: point.y + 4, above: point.y - 4, focusBack: element };
  return { x: rect.left, y: rect.bottom + 4, above: rect.top - 4, focusBack: element };
}

function useMarkRead(selectedId: string | null, chats: readonly ConversationSummary[]) {
  const client = useQueryClient();
  const marked = useRef<string | null>(null);
  const selected = chats.find((chat) => chat.id === selectedId);
  const key = selected?.unread ? `${selected.id}:${selected.latestRun?.id}` : null;
  useEffect(() => {
    if (!key || !selectedId || marked.current === key) return;
    marked.current = key;
    void api
      .markConversationRead(selectedId)
      .then(() => client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }));
  }, [key, selectedId, client]);
}

export function ConversationList({
  selectedId,
  onSelect,
  onNew,
  onNewInProject,
}: ConversationListProps) {
  const client = useQueryClient();
  const layout = useSidebarLayout();
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
    refetchInterval: (query) =>
      query.state.data?.some((chat) => isRunning(chat) || needsInput(chat)) ? POLL_MS : false,
  });
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const [tab, setTab] = useState<SidebarTab>('active');
  const [search, setSearch] = useState('');
  const filter = parseChatFilter(search);
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
  const [addingProject, setAddingProject] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const all = conversations.data ?? [];
  const actions = useChatActions({
    toaster,
    projects: projectList,
    selectedId,
    nextChatId: (excluding) =>
      all.find((chat) => chat.id !== excluding && !chat.archivedAt)?.id ?? null,
    onSelect,
    onNew,
  });
  const present = (chat: ConversationSummary) => !actions.deleting.has(chat.id);
  const chats = all.filter(present);
  const searching = query !== '' || isFiltering(filter);
  const found = query !== '' ? (results.data ?? []).filter(present) : chats;
  const visible = found.filter((chat) => matchesFilter(filter, chat.category));
  const byId = new Map([...chats, ...visible].map((chat) => [chat.id, chat]));
  const activeCount = chats.filter((chat) => !chat.archivedAt).length;
  const waiting = attention(chats, selectedId);
  useMarkRead(selectedId, chats);

  const addProject = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: async (project) => {
      setAddingProject(false);
      folds.open(project.id);
      toaster.show({ text: `Added project ${project.name}` });
      await client.invalidateQueries({ queryKey: projectKeys.all });
    },
  });

  const openChat = (id: string) => {
    onSelect(id);
    layout?.closeDrawer();
  };

  const grouped = activeGroups(visible, projectList);
  const projectById = new Map(projectList.map((project) => [project.id, project]));
  const dnd = useSidebarDnd({
    layout: chatLayout(grouped),
    projectIds: projectList.map((project) => project.id),
    chatTitle: (id) => byId.get(id)?.title ?? 'Chat',
    projectName: (id) => projectById.get(id)?.name ?? 'the project',
    onChatDrop: (drop) => {
      const chat = byId.get(drop.chatId);
      const group = groupOf(drop.to);
      if (chat) actions.drop(chat, group === NO_PROJECT ? null : group, drop.order);
    },
    onProjectsDrop: projectActions.reorder,
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isNewChatShortcut(event)) {
        event.preventDefault();
        startNew();
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      reveal?.();
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reveal, startNew]);

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

  const renderRow = (chat: ConversationSummary, sortable: boolean) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      selected={chat.id === selectedId}
      renaming={chat.id === renamingId}
      sortable={sortable}
      settling={dnd.busy}
      flash={chat.id === actions.flashId}
      onOpen={() => openChat(chat.id)}
      onMenu={(element, point) => setMenu({ chatId: chat.id, anchor: anchorFor(element, point) })}
      onRename={(title) => {
        setRenamingId(null);
        if (title) actions.rename(chat, title);
      }}
      onRestore={() => actions.archive(chat, false)}
      onDelete={() => actions.remove(chat)}
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
      renderRow={(chat) => renderRow(chat, canDrag && enabled)}
    />
  );

  const renderActive = () => {
    const blocks = dnd.projectIds.flatMap((id) => {
      const project = projectById.get(id);
      if (!project) return [];
      const pinned = rowsIn(pinnedIn(id));
      const rest = rowsIn(listIn(id));
      return [{ project, pinned, rest, count: pinned.length + rest.length }];
    });
    const shownBlocks = searching ? blocks.filter((block) => block.count > 0) : blocks;
    const loosePinned = rowsIn(pinnedIn(NO_PROJECT));
    const looseRest = rowsIn(LOOSE);
    const looseCount = loosePinned.length + looseRest.length;
    const nothing = searching && shownBlocks.length === 0 && looseCount === 0;
    if (nothing) return <p className="pempty wide">No active chats match “{search.trim()}”.</p>;
    return (
      <>
        <div className="sec">
          <span>Projects</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Add project"
            title="Add project"
            onClick={() => {
              addProject.reset();
              setAddingProject(true);
            }}
          >
            <PlusIcon />
          </button>
        </div>
        <SortableContext items={shownBlocks.map((block) => projectDragId(block.project.id))}>
          {shownBlocks.map(({ project, pinned, rest, count }) => {
            const open = searching || folds.isOpen(project.id);
            return (
              <ProjectGroup
                key={project.id}
                project={project}
                count={count}
                open={open}
                over={over === project.id}
                landed={dnd.landed?.group === project.id}
                sortable={canDrag}
                searching={searching}
                renaming={renamingProjectId === project.id}
                onToggle={() => folds.toggle(project.id)}
                onNewChat={() => onNewInProject(project.id)}
                onMenu={(element) =>
                  setProjectMenu({ projectId: project.id, anchor: anchorFor(element, null) })
                }
                onRename={(name) => {
                  setRenamingProjectId(null);
                  if (name) projectActions.rename(project, name);
                }}
              >
                {renderRows(pinnedIn(project.id), pinned, { sortable: true, enabled: open })}
                {renderRows(listIn(project.id), rest, { sortable: true, enabled: open })}
              </ProjectGroup>
            );
          })}
        </SortableContext>
        {(!searching || looseCount > 0) && (
          <LooseChats
            pinned={loosePinned}
            unpinned={looseRest}
            empty={
              chats.length === 0
                ? 'No chats yet. Start one with New chat.'
                : 'Drag a chat here to take it out of its project.'
            }
            searching={searching}
            over={over === NO_PROJECT}
            folds={folds}
            renderRows={renderRows}
          />
        )}
      </>
    );
  };

  const renderHistory = () => {
    const groups = historyGroups(visible);
    if (groups.length === 0) {
      return (
        <p className="pempty wide">
          {searching
            ? `No archived chats match “${search.trim()}”.`
            : 'Nothing archived. Archive a chat from its menu and it moves here.'}
        </p>
      );
    }
    return groups.map((group) => {
      const key = `section:history:${group.label}`;
      return (
        <FoldSection
          key={group.label}
          label={group.label}
          open={searching || folds.isOpen(key)}
          onToggle={() => folds.toggle(key)}
        >
          <ul className="rows">{group.chats.map((chat) => renderRow(chat, false))}</ul>
        </FoldSection>
      );
    });
  };

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
  const siblings =
    menuChat?.pinnedAt && !menuChat.archivedAt ? pinnedSiblings(chats, menuChat) : [];
  const moveUp = menuChat ? movedOrder(siblings, menuChat.id, -1) : null;
  const moveDown = menuChat ? movedOrder(siblings, menuChat.id, 1) : null;
  const menuProject = projectList.find((project) => project.id === projectMenu?.projectId);

  return (
    <nav className="side" aria-label="Chats" inert={layout?.hidden}>
      <div className="side-in">
        <div className="side-top">
          <b>Chats</b>
          <SidebarCollapseButton />
        </div>
        <NewChatButton onNew={startNew} />
        <SearchBox value={search} inputRef={searchRef} onChange={setSearch} />
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
            const approvalId = chat.attention?.approvalId;
            if (approvalId) scrollToAnchor(approvalAnchor(approvalId), JUMP_TRIES);
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
            aria-busy={searching && results.isFetching}
          >
            <div key={tab} className="list-in">
              {tab === 'active' ? renderActive() : renderHistory()}
            </div>
          </div>
        </SidebarDndContext>
        <ToastHost toaster={toaster} />
      </div>
      <SidebarResizer />
      {menu && menuChat && (
        <ChatMenu
          chat={menuChat}
          anchor={menu.anchor}
          projects={projectList}
          onClose={closeMenu}
          onRename={() => setRenamingId(menuChat.id)}
          onAutoTitle={(on) => actions.setAutoTitle(menuChat, on)}
          onPin={() => actions.pin(menuChat)}
          {...(siblings.length > 1
            ? {
                onMoveUp: moveUp ? () => actions.reorderPinned(moveUp) : null,
                onMoveDown: moveDown ? () => actions.reorderPinned(moveDown) : null,
              }
            : {})}
          onMove={(projectId) => actions.move(menuChat, projectId)}
          onArchive={(archived) => actions.archive(menuChat, archived)}
          onDelete={() => actions.remove(menuChat)}
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
      <AnimatePresence>
        {addingProject && (
          <FolderDialog
            key="add-project"
            linking={addProject.isPending}
            error={addProject.isError ? addProject.error.message : null}
            onUse={(rootPath) => addProject.mutate(rootPath)}
            onClose={() => setAddingProject(false)}
          />
        )}
      </AnimatePresence>
    </nav>
  );
}
