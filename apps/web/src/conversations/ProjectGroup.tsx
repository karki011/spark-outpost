import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Project } from '@spark-outpost/contracts';
import { ChevronIcon, DotsIcon, FolderIcon, GripIcon, PlusIcon } from '../ui/icons.tsx';
import { RenameInput } from './ChatRow.tsx';
import { useSortableMotion } from './use-sortable-motion.ts';
import { pointerStart, projectDragId } from './sidebar-dnd-geometry.ts';

interface ProjectGroupProps {
  project: Project;
  count: number;
  open: boolean;
  over: boolean;
  landed: boolean;
  sortable: boolean;
  searching: boolean;
  renaming: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onMenu: (element: HTMLElement) => void;
  onRename: (name: string | null) => void;
  children: ReactNode;
}

export function ProjectGroup({
  project,
  count,
  open,
  over,
  landed,
  sortable,
  searching,
  renaming,
  onToggle,
  onNewChat,
  onMenu,
  onRename,
  children,
}: ProjectGroupProps) {
  const bodyId = `pbody-${project.id}`;
  const slide = useSortableMotion();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: projectDragId(project.id),
    data: { type: 'project', projectId: project.id },
    disabled: { draggable: !sortable || renaming, droppable: false },
    ...slide,
  });
  const draggable = sortable && !renaming;
  const classes = [
    'pblock',
    open ? 'open' : '',
    over ? 'over' : '',
    landed ? 'landed' : '',
    isDragging ? 'placeholder' : '',
  ].filter(Boolean);
  const pointerListeners = pointerStart(listeners, draggable);
  return (
    <div
      ref={setNodeRef}
      className={classes.join(' ')}
      style={{ transform: CSS.Translate.toString(transform), transition: transition }}
      data-project={project.id}
    >
      <div className={`proj${renaming ? ' renaming' : ''}`}>
        {renaming ? (
          <div className="proj-head">
            <ChevronIcon />
            <FolderIcon />
            <span className="nm">
              <RenameInput title={project.name} label="Project name" onDone={onRename} />
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="proj-head"
            aria-expanded={open}
            aria-controls={bodyId}
            title={project.displayPath}
            onClick={onToggle}
            {...pointerListeners}
          >
            <ChevronIcon />
            <FolderIcon />
            <span className="nm">{project.name}</span>
            <span className="c" aria-label={`${count} ${count === 1 ? 'chat' : 'chats'}`}>
              {count || ''}
            </span>
          </button>
        )}
        {!renaming && (
          <span className="pa">
            {draggable && (
              <button
                type="button"
                ref={setActivatorNodeRef}
                className="icon-btn pgrip"
                title="Drag to reorder"
                {...attributes}
                {...listeners}
                aria-label={`Move project ${project.name}`}
              >
                <GripIcon />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={`New chat in ${project.name}`}
              title={`New chat in ${project.name}`}
              onClick={onNewChat}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Options for project ${project.name}`}
              aria-haspopup="menu"
              onClick={(event) => onMenu(event.currentTarget)}
            >
              <DotsIcon />
            </button>
          </span>
        )}
      </div>
      <div className="pbody" id={bodyId} inert={!open}>
        <div>
          {count > 0
            ? children
            : !searching && (
                <p className="pempty">
                  {over ? (
                    'Drop to move it here'
                  ) : (
                    <button type="button" className="pnew" onClick={onNewChat}>
                      <PlusIcon />
                      New chat
                    </button>
                  )}
                </p>
              )}
        </div>
      </div>
    </div>
  );
}
