import './project.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FolderListing } from '@spark-outpost/contracts';
import { formatBytes } from '../../api/attachments.ts';
import { projectKeys, projectsApi, type FolderPick } from '../../api/projects.ts';
import { BlobToggle } from '../../brand/BlobToggle.tsx';
import { FileIcon } from '../attachments/attachment-icons.tsx';
import { breadcrumbs } from './folder-path.ts';
import { wrapTabFocus } from '../../ui/focus-trap.ts';
import { ChevronIcon, FolderIcon, ParentFolderIcon } from '../../ui/icons.tsx';
import { reveal } from '../../ui/transitions.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';

type FolderPurpose = 'project' | 'reference' | 'instructions';

const FOCUSABLE = 'button:not(:disabled)';

const COPY: Record<FolderPurpose, { title: string; lede: string; use: string }> = {
  instructions: {
    title: 'Choose an instructions file',
    lede: 'Markdown and text files are listed. Spark reads the file when a chat starts and never changes it. Secret files are left out.',
    use: 'Use this file',
  },
  project: {
    title: 'Choose a project folder',
    lede: "Your AI can read files in this folder to answer questions. It won't change them.",
    use: 'Use this folder',
  },
  reference: {
    title: 'Add a folder',
    lede: 'The agent reads this folder with its tools when it needs to. Nothing is copied into the chat. A folder outside your projects is added as a project.',
    use: 'Add this folder',
  },
};

function emptyNote(listing: FolderListing, picksFile: boolean): string | null {
  if (listing.folders.length > 0) return null;
  if (!picksFile) return 'No folders inside.';
  return listing.files.length === 0 ? 'No folders or instruction files here.' : null;
}

interface FolderDialogProps {
  linking: boolean;
  error: string | null;
  onUse: (path: string) => void;
  onClose: () => void;
  purpose?: FolderPurpose;
  startPath?: string | null;
  stacked?: boolean;
  inline?: boolean;
  fallback?: { label: string; onPick: () => void } | null;
}

export function FolderDialog({
  linking,
  error,
  onUse,
  onClose,
  purpose = 'project',
  startPath = null,
  stacked = purpose !== 'project',
  inline = false,
  fallback = null,
}: FolderDialogProps) {
  const copy = COPY[purpose];
  const picksFile = purpose === 'instructions';
  const [path, setPath] = useState<string | null>(startPath);
  const [hidden, setHidden] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pick: FolderPick = { files: picksFile ? 'instructions' : null, hidden };
  const listing = useQuery({
    queryKey: projectKeys.folders(path, pick),
    queryFn: () => projectsApi.folders(path, pick),
    placeholderData: keepPreviousData,
  });
  const current = listing.data;
  const picked = current?.files.find((entry) => entry.path === file)?.path ?? null;
  const chosen = picksFile ? picked : (current?.path ?? null);
  const empty = current ? emptyNote(current, picksFile) : null;
  const open = (next: string) => {
    setFile(null);
    setPath(next);
  };

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      const buttons = [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (event.key === 'Tab' && event.shiftKey && document.activeElement === panel) {
        event.preventDefault();
        buttons.at(-1)?.focus();
        return;
      }
      wrapTabFocus(event, () => buttons);
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const content = (
    <>
      <div className="fdlg-head">
        <h3 id="fdlg-title">{copy.title}</h3>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <p className="fdlg-lede" id="fdlg-lede">
        {copy.lede}
      </p>
      <div className="fdlg-bar">
        <button
          type="button"
          className="icon-btn"
          aria-label="Parent folder"
          title="Parent folder"
          disabled={!current?.parent}
          onClick={() => current?.parent && open(current.parent)}
        >
          <ParentFolderIcon />
        </button>
        <nav className="fdlg-crumbs" aria-label="Folder path">
          {current &&
            breadcrumbs(current.path).map((crumb, index, all) => (
              <span key={crumb.path} className="fdlg-crumb">
                {index > 1 && <span className="fdlg-sep">/</span>}
                <button
                  type="button"
                  aria-current={index === all.length - 1 ? 'location' : undefined}
                  onClick={() => open(crumb.path)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
        </nav>
      </div>
      <div className="fdlg-list" aria-busy={listing.isFetching}>
        {listing.isError && (
          <p className="fdlg-note bad" role="alert">
            {listing.error.message}
          </p>
        )}
        {listing.isError && fallback && (
          <button type="button" className="btn line sm fdlg-fallback" onClick={fallback.onPick}>
            {fallback.label}
          </button>
        )}
        {listing.isPending && <Skeleton label="Opening the folder" shape="list" rows={6} />}
        {empty && <p className="fdlg-note">{empty}</p>}
        <ul aria-label="Folders">
          {current?.folders.map((folder) => (
            <li key={folder.path}>
              <button type="button" className="fdlg-row" onClick={() => open(folder.path)}>
                <FolderIcon />
                <span>{folder.name}</span>
                <ChevronIcon />
              </button>
            </li>
          ))}
        </ul>
        {picksFile && current && current.files.length > 0 && (
          <ul aria-label="Files">
            {current.files.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="fdlg-row"
                  aria-pressed={entry.path === picked}
                  onClick={() => setFile(entry.path)}
                  onDoubleClick={() => onUse(entry.path)}
                >
                  <FileIcon />
                  <span>{entry.name}</span>
                  <small>{formatBytes(entry.sizeBytes)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {picksFile && (
        <label className="fdlg-hidden">
          <BlobToggle
            size="sm"
            label="Show hidden folders and files"
            checked={hidden}
            onChange={setHidden}
          />
          <span aria-hidden="true">Show hidden folders and files</span>
        </label>
      )}
      {error && (
        <p className="fdlg-error" role="alert">
          {error}
        </p>
      )}
      <div className="fdlg-foot">
        <span className="fdlg-path" title={chosen ?? current?.path}>
          {chosen ?? current?.path ?? ''}
        </span>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={!chosen || linking}
          onClick={() => chosen && onUse(chosen)}
        >
          {linking ? 'Linking…' : copy.use}
        </button>
      </div>
    </>
  );
  const dialog = {
    ref: panelRef,
    tabIndex: -1,
    role: 'dialog',
    'aria-labelledby': 'fdlg-title',
    'aria-describedby': 'fdlg-lede',
  } as const;

  if (inline) {
    return (
      <div {...dialog} className="fdlg inline">
        {content}
      </div>
    );
  }

  return createPortal(
    <motion.div
      className={stacked ? 'fdlg-scrim over-dialog' : 'fdlg-scrim'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reveal}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        {...dialog}
        className="fdlg"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={reveal}
      >
        {content}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
