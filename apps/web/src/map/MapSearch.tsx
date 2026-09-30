import { useId, useState, type RefObject } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { useFileSearch, type RepoFile } from '../chat/project/use-file-search.ts';
import { baseName, folderOf, type FileKind } from './file-kind.ts';
import { KindDot } from './JevLabel.tsx';

interface MapSearchProps {
  projects: readonly Project[];
  inputRef: RefObject<HTMLInputElement | null>;
  kindOf: (projectId: string, path: string) => FileKind | null;
  onPick: (file: RepoFile) => void;
}

const SHOWN = 8;

export function MapSearch({ projects, inputRef, kindOf, onPick }: MapSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const search = useFileSearch(projects, query, open && query.trim().length > 0);
  const files = search.files.slice(0, SHOWN);
  const expanded = open && query.trim().length > 0;
  const pick = (file: RepoFile) => {
    setQuery(baseName(file.path));
    setOpen(false);
    onPick(file);
  };
  const optionId = (index: number) => `${listId}-${index}`;
  return (
    <div className="map-search" role="search">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path
          d="m20 20-3.5-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && files.length > 0 ? optionId(search.active) : undefined}
        aria-label="Find a file on the map"
        placeholder="Find a file"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (expanded) search.handleKey(event, pick);
        }}
      />
      <kbd className="map-kbd" aria-hidden="true">
        /
      </kbd>
      {expanded && (
        <ul className="map-results" id={listId} role="listbox" aria-label="Matching files">
          {files.length === 0 ? (
            <li className="map-empty" role="option" aria-selected={false} aria-disabled="true">
              {search.loading ? 'Looking…' : `No file matches “${query.trim()}”`}
            </li>
          ) : (
            files.map((file, index) => (
              <li
                key={`${file.projectId}:${file.path}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === search.active}
                onPointerDown={(event) => {
                  event.preventDefault();
                  pick(file);
                }}
                onPointerEnter={() => search.setActive(index)}
              >
                <KindDot kind={kindOf(file.projectId, file.path) ?? 'other'} />
                <span className="map-mono map-nm">{baseName(file.path)}</span>
                <span className="map-mono map-pt">
                  {projects.length > 1 ? `${file.repo} · ` : ''}
                  {folderOf(file.path)}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
