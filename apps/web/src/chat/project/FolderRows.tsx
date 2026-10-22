import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import type { FolderListingEntry } from '@spark-outpost/contracts';
import { ChevronIcon, FolderIcon } from '../../ui/icons.tsx';

interface FolderRowsProps {
  path: string | null;
  folders: readonly FolderListingEntry[];
  projectRoots: ReadonlySet<string>;
  onOpen: (path: string) => void;
  onParent: () => void;
}

function rowButtons(list: HTMLElement | null): HTMLButtonElement[] {
  return [...(list?.querySelectorAll<HTMLButtonElement>('.fdlg-row') ?? [])];
}

function marks(folder: FolderListingEntry, project: boolean): string[] {
  return [project ? 'Project' : null, folder.repository ? 'Git' : null].filter(
    (mark) => mark !== null,
  );
}

export function FolderRows({ path, folders, projectRoots, onOpen, onParent }: FolderRowsProps) {
  const ids = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const focusNext = useRef(false);

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    const first = rowButtons(listRef.current)[0];
    if (first) first.focus();
    else listRef.current?.focus();
  }, [path]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const rows = rowButtons(listRef.current);
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      rows[Math.min(rows.length - 1, Math.max(0, at + step))]?.focus();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusNext.current = true;
      onParent();
      return;
    }
    if ((event.key === 'ArrowRight' || event.key === 'Enter') && at >= 0) {
      event.preventDefault();
      focusNext.current = true;
      rows[at]!.click();
    }
  };

  return (
    <ul ref={listRef} aria-label="Folders" tabIndex={-1} onKeyDown={onKeyDown}>
      {folders.map((folder, index) => {
        const tags = marks(folder, projectRoots.has(folder.path));
        const describedBy = tags.length > 0 ? `${ids}${index}` : undefined;
        return (
          <li key={folder.path}>
            <button
              type="button"
              className="fdlg-row"
              aria-label={folder.name}
              aria-describedby={describedBy}
              onClick={() => onOpen(folder.path)}
            >
              <FolderIcon />
              <span>{folder.name}</span>
              {tags.length > 0 && (
                <span className="fdlg-tags" id={describedBy}>
                  {tags.map((tag) => (
                    <em key={tag} className="fdlg-tag">
                      {`${tag} `}
                    </em>
                  ))}
                </span>
              )}
              <ChevronIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
