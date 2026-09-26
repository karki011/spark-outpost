import '../ui/panel-motion.css';
import './sidebar.css';
import './sidebar-chrome.css';
import './chat-row.css';
import './chat-menu.css';
import './sidebar-layout.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
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
import { FoldSection } from './FoldSection.tsx';
import { LooseChats } from './LooseChats.tsx';
import { ProjectGroup } from './ProjectGroup.tsx';
import { ProjectMenu } from './ProjectMenu.tsx';
import { attention, isRunning, needsInput } from './row-state.ts';
import { activeGroups, historyGroups, movedOrder, pinnedSiblings } from './sidebar-groups.ts';
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
import { NO_PROJECT, useChatDrag, type Point } from './use-chat-drag.ts';
import { useProjectActions } from './use-project-actions.ts';
import { useSidebarFolds } from './use-sidebar-folds.ts';
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

  const drag = useChatDrag({
    listRef,
    onDrop: (chatId, target) => {
      const chat = byId.get(chatId);
      if (chat) actions.move(chat, target === NO_PROJECT ? null : target);
    },
    onHold: (chatId, point) => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-chat="${chatId}"]`);
      if (row) setMenu({ chatId, anchor: anchorFor(row, point) });
    },
  });
  const over = drag.drag?.over ?? null;
  const overFolded = over !== null && over !== NO_PROJECT && !folds.isOpen(over);
  const openFold = folds.open;

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

  const renderRow = (chat: ConversationSummary, onReorderEnd?: () => void) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      selected={chat.id === selectedId}
      renaming={chat.id === renamingId}
      dragging={drag.drag?.chatId === chat.id}
      flash={chat.id === actions.flashId}
      onOpen={() => {
        if (!drag.consumeClick()) openChat(chat.id);
      }}
      onMenu={(element, point) => setMenu({ chatId: chat.id, anchor: anchorFor(element, point) })}
      onRename={(title) => {
        setRenamingId(null);
        if (title) actions.rename(chat, title);
      }}
      onRestore={() => actions.archive(chat, false)}
      onDelete={() => actions.remove(chat)}
      onDragStart={(event) => drag.start(event, chat.id, chat.title)}
      onReorderEnd={onReorderEnd}
    />
  );

  const renderRows = (rows: readonly ConversationSummary[]) => (
    <ChatRows chats={rows} renderRow={renderRow} onReorder={actions.reorderPinned} />
  );

  const renderActive = () => {
    const { groups, loose } = activeGroups(visible, projectList);
    const shownGroups = searching ? groups.filter((group) => group.chats.length > 0) : groups;
    const nothing = searching && shownGroups.length === 0 && loose.length === 0;
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
        {shownGroups.map(({ project, chats: rows }) => (
          <ProjectGroup
            key={project.id}
            project={project}
            count={rows.length}
            open={searching || folds.isOpen(project.id)}
            over={over === project.id}
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
            {renderRows(rows)}
          </ProjectGroup>
        ))}
        {(!searching || loose.length > 0) && (
          <LooseChats
            chats={loose}
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
          <ul className="rows">{group.chats.map((chat) => renderRow(chat))}</ul>
        </FoldSection>
      );
    });
  };

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
        <div
          ref={listRef}
          id={LIST_PANEL_ID}
          role="tabpanel"
          aria-label={tab === 'active' ? 'Active chats' : 'Archived chats'}
          className={`list${drag.drag ? ' dragging' : ''}`}
          aria-busy={searching && results.isFetching}
        >
          <div key={tab} className="list-in">
            {tab === 'active' ? renderActive() : renderHistory()}
          </div>
        </div>
        <ToastHost toaster={toaster} />
      </div>
      <SidebarResizer />
      {drag.drag &&
        createPortal(
          <div
            className="drag-ghost"
            style={{ transform: `translate(${drag.drag.x + 12}px, ${drag.drag.y + 10}px)` }}
            aria-hidden="true"
          >
            {drag.drag.title}
          </div>,
          document.body,
        )}
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
