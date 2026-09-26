import type { ReactNode } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { ChevronIcon, DotsIcon, FolderIcon, PlusIcon } from '../ui/icons.tsx';
import { RenameInput } from './ChatRow.tsx';

interface ProjectGroupProps {
  project: Project;
  count: number;
  open: boolean;
  over: boolean;
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
  searching,
  renaming,
  onToggle,
  onNewChat,
  onMenu,
  onRename,
  children,
}: ProjectGroupProps) {
  const bodyId = `pbody-${project.id}`;
  return (
    <div className={`pblock${open ? ' open' : ''}${over ? ' over' : ''}`} data-drop={project.id}>
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
                  No chats yet.{' '}
                  <button type="button" onClick={onNewChat}>
                    Start one
                  </button>{' '}
                  or drag one here.
                </p>
              )}
        </div>
      </div>
    </div>
  );
}
