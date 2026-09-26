import { useEffect, useRef } from 'react';
import { formatBytes } from '../../api/attachments.ts';
import { CheckIcon } from '../../ui/icons.tsx';
import { FileIcon } from '../attachments/attachment-icons.tsx';
import { repoFileKey, type FileSearch, type RepoFile } from './use-file-search.ts';

interface FileListProps {
  id: string;
  search: FileSearch;
  attached: ReadonlySet<string>;
  onPick: (file: RepoFile) => void;
}

export function optionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return { name: path, folder: '' };
  return { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

export function FileList({ id, search, attached, onPick }: FileListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { files, active } = search;

  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(id, active))}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [id, active]);

  return (
    <>
      <div ref={listRef} id={id} className="flist" role="listbox" aria-label="Project files">
        {files.map((file, index) => {
          const { name, folder } = splitPath(file.path);
          const key = repoFileKey(file);
          const added = attached.has(key);
          return (
            <div
              key={key}
              id={optionId(id, index)}
              className="fopt"
              role="option"
              aria-selected={index === active}
              data-added={added || undefined}
              title={`${file.repo}/${file.path}`}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => {
                if (index !== active) search.setActive(index);
              }}
              onClick={() => onPick(file)}
            >
              <FileIcon />
              <span className="fname">
                <b>{name}</b>
                <small>{folder ? `${file.repo}/${folder}` : file.repo}</small>
              </span>
              {added ? <CheckIcon className="fadded" /> : <small>{formatBytes(file.size)}</small>}
            </div>
          );
        })}
      </div>
      <FileListStatus search={search} />
    </>
  );
}

function FileListStatus({ search }: { search: FileSearch }) {
  if (search.error) {
    return (
      <p className="mpop-error" role="alert">
        {search.error}
      </p>
    );
  }
  if (search.files.length === 0) {
    return <p className="mempty">{search.loading ? 'Searching…' : 'No matching files.'}</p>;
  }
  if (search.truncated) {
    return <p className="eff-note">Showing the first {search.files.length}. Type to narrow it.</p>;
  }
  return null;
}
