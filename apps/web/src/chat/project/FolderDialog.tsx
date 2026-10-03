import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { projectKeys, projectsApi } from '../../api/projects.ts';
import { breadcrumbs } from './folder-path.ts';
import { ChevronIcon, FolderIcon, ParentFolderIcon } from '../../ui/icons.tsx';
import { reveal } from '../../ui/transitions.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';

type FolderPurpose = 'project' | 'reference';

const COPY: Record<FolderPurpose, { title: string; lede: string; use: string }> = {
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

interface FolderDialogProps {
  linking: boolean;
  error: string | null;
  onUse: (path: string) => void;
  onClose: () => void;
  purpose?: FolderPurpose;
  startPath?: string | null;
}

export function FolderDialog({
  linking,
  error,
  onUse,
  onClose,
  purpose = 'project',
  startPath = null,
}: FolderDialogProps) {
  const copy = COPY[purpose];
  const [path, setPath] = useState<string | null>(startPath);
  const panelRef = useRef<HTMLDivElement>(null);
  const listing = useQuery({
    queryKey: projectKeys.folders(path),
    queryFn: () => projectsApi.folders(path),
    placeholderData: keepPreviousData,
  });
  const current = listing.data;

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <motion.div
      className={purpose === 'reference' ? 'fdlg-scrim over-dialog' : 'fdlg-scrim'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reveal}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={panelRef}
        className="fdlg"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fdlg-title"
        aria-describedby="fdlg-lede"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={reveal}
      >
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
            onClick={() => current?.parent && setPath(current.parent)}
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
                    onClick={() => setPath(crumb.path)}
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
          {listing.isPending && <Skeleton label="Opening the folder" shape="list" rows={6} />}
          {current?.folders.length === 0 && <p className="fdlg-note">No folders inside.</p>}
          <ul aria-label="Folders">
            {current?.folders.map((folder) => (
              <li key={folder.path}>
                <button type="button" className="fdlg-row" onClick={() => setPath(folder.path)}>
                  <FolderIcon />
                  <span>{folder.name}</span>
                  <ChevronIcon />
                </button>
              </li>
            ))}
          </ul>
        </div>
        {error && (
          <p className="fdlg-error" role="alert">
            {error}
          </p>
        )}
        <div className="fdlg-foot">
          <span className="fdlg-path" title={current?.path}>
            {current?.path ?? ''}
          </span>
          <button type="button" className="btn ghost sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={!current || linking}
            onClick={() => current && onUse(current.path)}
          >
            {linking ? 'Linking…' : copy.use}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
