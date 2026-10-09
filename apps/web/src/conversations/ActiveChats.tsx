import { SortableContext } from '@dnd-kit/sortable';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import { useOutpostSeam } from '../chat/outpost/outpost-seam.ts';
import { PlusIcon } from '../ui/icons.tsx';
import { LooseChats, type RenderRows } from './LooseChats.tsx';
import { OutpostRows } from './OutpostRows.tsx';
import { ProjectGroup } from './ProjectGroup.tsx';
import { NO_PROJECT, listIn, pinnedIn, LOOSE } from './sidebar-order.ts';
import { useSidebarLayout } from './sidebar-layout.tsx';
import type { SidebarDnd } from './use-sidebar-dnd.ts';
import type { SidebarFolds } from './use-sidebar-folds.ts';
import { listSorting, projectDragId } from './sidebar-dnd-geometry.ts';

interface ActiveChatsProps {
  search: string;
  searching: boolean;
  canDrag: boolean;
  hasChats: boolean;
  hasProjects: boolean;
  projectById: ReadonlyMap<string, Project>;
  dnd: SidebarDnd;
  folds: SidebarFolds;
  renamingProjectId: string | null;
  rowsIn: (container: string) => ConversationSummary[];
  renderRows: RenderRows;
  onAddProject: () => void;
  onNewInProject: (projectId: string) => void;
  onProjectMenu: (projectId: string, element: HTMLElement) => void;
  onProjectRename: (project: Project, name: string | null) => void;
}

export function ActiveChats({
  search,
  searching,
  canDrag,
  hasChats,
  hasProjects,
  projectById,
  dnd,
  folds,
  renamingProjectId,
  rowsIn,
  renderRows,
  onAddProject,
  onNewInProject,
  onProjectMenu,
  onProjectRename,
}: ActiveChatsProps) {
  const outpostSeam = useOutpostSeam();
  const layout = useSidebarLayout();
  const over = dnd.overGroup;
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
      {outpostSeam && !searching && (
        <OutpostRows
          outposts={outpostSeam.outposts}
          openId={outpostSeam.openOutpostId}
          onOpen={(id) => {
            outpostSeam.onOpenOutpost(id);
            layout?.closeDrawer();
          }}
          onNew={outpostSeam.canManage ? () => outpostSeam.onNewOutpost() : undefined}
        />
      )}
      <div className="sec">
        <span>Projects</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Add project"
          title="Add project"
          onClick={onAddProject}
        >
          <PlusIcon />
        </button>
      </div>
      <SortableContext
        items={shownBlocks.map((block) => projectDragId(block.project.id))}
        strategy={listSorting}
      >
        {shownBlocks.map(({ project, pinned, rest, count }) => {
          const open = searching || folds.isOpen(project.id) || over === project.id;
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
              onMenu={(element) => onProjectMenu(project.id, element)}
              onRename={(name) => onProjectRename(project, name)}
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
            hasChats
              ? 'Drag a chat here to take it out of its project.'
              : hasProjects
                ? null
                : 'No chats yet. Start one with New chat.'
          }
          searching={searching}
          over={over === NO_PROJECT}
          folds={folds}
          renderRows={renderRows}
        />
      )}
    </>
  );
}
