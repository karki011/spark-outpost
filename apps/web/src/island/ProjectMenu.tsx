import { useState, type KeyboardEvent, type RefObject } from 'react';
import type { Project } from '@spark-outpost/contracts';
import type { PickerAction } from '../ui/ChoicePicker.tsx';

const FILTER_FROM = 7;

export function recentProjects(projects: readonly Project[]): Project[] {
  return projects.toSorted((a, b) =>
    (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt),
  );
}

interface ProjectMenuProps {
  projects: readonly Project[];
  selected: string | null | undefined;
  busy: boolean;
  error: string | null;
  actions: readonly PickerAction[];
  chipRef: RefObject<HTMLButtonElement | null>;
  onPick: (id: string | null) => void;
  onAction: (action: PickerAction) => void;
  onClose: () => void;
}

export function ProjectMenu(props: ProjectMenuProps) {
  const { projects, selected } = props;
  const [query, setQuery] = useState('');
  const filtering = projects.length >= FILTER_FROM;
  const needle = query.trim().toLowerCase();
  const shown = recentProjects(projects).filter(
    (project) =>
      !needle ||
      project.name.toLowerCase().includes(needle) ||
      project.displayPath.toLowerCase().includes(needle),
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === 'Escape') {
      props.onClose();
      props.chipRef.current?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      className="isl-menu"
      id="isl-qmenu"
      role="menu"
      aria-label="Choose project"
      onKeyDown={onKeyDown}
    >
      {filtering && (
        <input
          className="isl-menu-filter"
          type="search"
          role="searchbox"
          aria-label="Filter projects"
          placeholder="Filter projects"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div className="isl-menu-list">
        {projects.length === 0 && <p className="isl-menu-empty">No projects yet</p>}
        {shown.map((project, index) => (
          <button
            key={project.id}
            type="button"
            role="menuitemradio"
            aria-checked={project.id === selected}
            autoFocus={!filtering && index === 0}
            onClick={() => props.onPick(project.id)}
          >
            <span className="check" aria-hidden="true">
              ✓
            </span>
            <span>{project.name}</span>
            <small>{project.displayPath}</small>
          </button>
        ))}
        {needle && shown.length === 0 && (
          <p className="isl-menu-empty">No project matches “{query.trim()}”.</p>
        )}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={selected === null}
          autoFocus={!filtering && projects.length === 0}
          onClick={() => props.onPick(null)}
        >
          <span className="check" aria-hidden="true">
            ✓
          </span>
          <span>No project</span>
          <small>Chat only, no files</small>
        </button>
      </div>
      {props.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className="isl-menu-add"
          disabled={props.busy || action.disabled}
          title={action.description}
          onClick={() => props.onAction(action)}
        >
          <span aria-hidden="true">+</span>
          <span>{action.label}</span>
        </button>
      ))}
      {props.error && (
        <p className="isl-menu-empty bad" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}
