import { useEffect, useId, useRef, useState } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { FileList, optionId } from './FileList.tsx';
import { repoSummary } from './repo-list.ts';
import { useFileSearch, type RepoFile } from './use-file-search.ts';

interface RepoFilePickerProps {
  repos: readonly Project[];
  attached: ReadonlySet<string>;
  onPick: (file: RepoFile) => void;
  onClose: () => void;
}

export function RepoFilePicker({ repos, attached, onPick, onClose }: RepoFilePickerProps) {
  const [query, setQuery] = useState('');
  const search = useFileSearch(repos, query, true);
  const label = repos.length === 1 ? repos[0]!.name : 'linked repos';
  const listId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="mpop left filepop open"
      role="dialog"
      aria-label={`Add files from ${repoSummary(repos.map((repo) => repo.name))}`}
    >
      <input
        ref={inputRef}
        className="fsearch"
        type="search"
        role="combobox"
        aria-label="Search project files"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          search.files.length > 0 ? optionId(listId, search.active) : undefined
        }
        placeholder={`Search ${label}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          search.handleKey(event, onPick);
        }}
      />
      <FileList id={listId} search={search} attached={attached} onPick={onPick} />
      <p className="eff-note">Read-only. Enter adds a file, Esc closes.</p>
    </div>
  );
}
