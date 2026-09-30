import { useEffect, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { ChevronIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';

interface RepoPickerProps {
  projects: readonly Project[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}

const TINTS = 4;

function tint(index: number): string {
  return `var(--map-tint-${(index % TINTS) + 1})`;
}

export function RepoPicker({ projects, selected, onChange }: RepoPickerProps) {
  const { open, toggle, anchorRef, panelRef } = usePopover<HTMLButtonElement, HTMLDivElement>();
  const menuId = useId();
  const chosen = selected
    .map((id) => projects.find((project) => project.id === id))
    .filter((project) => project !== undefined);
  const single = chosen.length === 1 ? chosen[0]! : null;
  const git = useQuery({
    queryKey: projectKeys.git(single?.id ?? ''),
    queryFn: () => projectsApi.git(single!.id),
    enabled: single !== null,
    retry: false,
  });
  const branch = git.data && 'branch' in git.data ? git.data.branch : null;

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')?.focus();
  }, [open, panelRef]);

  const flip = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
    if (next.length > 0) onChange(next);
  };

  const label = chosen.map((project) => project.name).join(' + ') || 'Choose a project';
  return (
    <div className="map-repo">
      <button
        ref={anchorRef}
        type="button"
        className="map-btn map-repo-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Projects on the map: ${label}`}
        onClick={toggle}
      >
        <span className="map-repo-dots" aria-hidden="true">
          {chosen.map((project, index) => (
            <i
              key={project.id}
              style={{ background: chosen.length > 1 ? tint(index) : 'var(--map-gold)' }}
            />
          ))}
        </span>
        <span className="map-repo-name">{label}</span>
        {branch && <span className="map-mono map-faint">{branch}</span>}
        <ChevronIcon />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          className="map-pop"
          role="menu"
          aria-label="Projects on the map"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const items = [
              ...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ??
                []),
            ];
            const index = items.indexOf(document.activeElement as HTMLElement);
            items[
              (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            ]?.focus();
          }}
        >
          <p className="map-pop-lab">Map these projects</p>
          {projects.map((project) => {
            const on = selected.includes(project.id);
            return (
              <button
                key={project.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className="map-pop-item"
                onClick={() => flip(project.id)}
              >
                <span className="map-check" aria-hidden="true" />
                <span>
                  {project.name}
                  <small>{project.rootPath}</small>
                </span>
              </button>
            );
          })}
          <p className="map-pop-note">Pick two or more to see how they connect.</p>
        </div>
      )}
    </div>
  );
}
