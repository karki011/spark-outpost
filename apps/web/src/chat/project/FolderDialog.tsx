import './project.css';
import '../../projects/add-folder.css';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FolderListing, Project } from '@spark-outpost/contracts';
import { formatBytes } from '../../api/attachments.ts';
import { projectKeys, projectsApi, type FolderPick } from '../../api/projects.ts';
import { BlobToggle } from '../../brand/BlobToggle.tsx';
import { FileIcon } from '../attachments/attachment-icons.tsx';
import { ClonePanel } from './clone/ClonePanel.tsx';
import { useCloneNeedsAttention } from './clone/use-clone-jobs.ts';
import { breadcrumbs } from './folder-path.ts';
import { FolderPlaces } from './FolderPlaces.tsx';
import { FolderRows } from './FolderRows.tsx';
import { NewFolderField } from './NewFolderField.tsx';
import { useProjects } from './use-chat-repos.ts';
import { sparkDesktop } from '../../desktop/desktop-bridge.ts';
import { wrapTabFocus } from '../../ui/focus-trap.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { ParentFolderIcon, PlusIcon } from '../../ui/icons.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { reveal } from '../../ui/transitions.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';

type FolderPurpose = 'project' | 'reference' | 'instructions';
type Mode = 'browse' | 'clone' | 'clone-parent';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled)';

const WAYS = [
  { id: 'browse', label: 'Choose a folder' },
  { id: 'clone', label: 'Clone a repository' },
];

const CLONE_COPY: Record<
  Exclude<Mode, 'browse'>,
  { title: string; lede: string; remoteLede?: string; use: string }
> = {
  clone: {
    title: 'Clone a repository',
    lede: 'Spark runs git clone on this Mac, straight from the git host, then adds the new folder as a project.',
    remoteLede:
      'Spark runs git clone on your Mac, straight from the git host, then adds the new folder as a project.',
    use: '',
  },
  'clone-parent': {
    title: 'Choose where to clone',
    lede: 'Spark creates the repository’s folder inside the folder you pick.',
    use: 'Clone into this folder',
  },
};

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
  if (listing.denied || listing.folders.length > 0) return null;
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
  onCloned?: ((project: Project) => void) | null;
  initialMode?: 'browse' | 'clone';
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
  onCloned = null,
  initialMode = 'browse',
}: FolderDialogProps) {
  const ids = useId();
  const [chosenMode, setMode] = useState<Mode | null>(
    initialMode === 'clone' && onCloned ? 'clone' : null,
  );
  const [naming, setNaming] = useState(false);
  const newFolderRef = useRef<HTMLButtonElement>(null);
  const stopNaming = () => {
    setNaming(false);
    requestAnimationFrame(() => newFolderRef.current?.focus());
  };
  const cloneWaiting = useCloneNeedsAttention(onCloned !== null);
  if (cloneWaiting && chosenMode === null) setMode('clone');
  const mode = chosenMode ?? 'browse';
  const [cloneParent, setCloneParent] = useState<string | null>(null);
  const copy = mode === 'browse' ? COPY[purpose] : CLONE_COPY[mode];
  const { remote, allows } = useRemoteClient();
  const canMakeFolder = purpose === 'project' && allows('projects');
  const remoteLede = remote && mode !== 'browse' ? CLONE_COPY[mode].remoteLede : undefined;
  const lede = remoteLede ?? copy.lede;
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
  const current = listing.isError ? undefined : listing.data;
  const projects = useProjects();
  const projectRoots = new Set((projects.data ?? []).map((project) => project.rootPath));
  const privacy = remote ? null : (sparkDesktop()?.privacy ?? null);
  const picked = current?.files.find((entry) => entry.path === file)?.path ?? null;
  const chosen = picksFile ? picked : (current?.path ?? null);
  const empty = current ? emptyNote(current, picksFile) : null;
  const open = (next: string) => {
    setFile(null);
    setNaming(false);
    setPath(next);
  };

  const dismiss = mode === 'clone-parent' ? () => setMode('clone') : onClose;
  const use = (target: string) => {
    if (mode !== 'clone-parent') return onUse(target);
    setCloneParent(target);
    setMode('clone');
  };

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
  }, [mode]);

  useEffect(() => {
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
      if (naming) stopNaming();
      else dismiss();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  const browser = (
    <>
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
        {canMakeFolder && current && !naming && (
          <button
            ref={newFolderRef}
            type="button"
            className="btn ghost sm fdlg-new"
            onClick={() => setNaming(true)}
          >
            <PlusIcon />
            New folder
          </button>
        )}
      </div>
      <FolderPlaces
        places={listing.data?.places ?? []}
        current={current?.path ?? null}
        onOpen={open}
      />
      {naming && current && (
        <NewFolderField parent={current.path} onCreated={open} onCancel={stopNaming} />
      )}
      <div className="fdlg-list" aria-busy={listing.isFetching}>
        {listing.isError && (
          <p className="fdlg-note bad" role="alert">
            {listing.error.message}
          </p>
        )}
        {listing.isPending && <Skeleton label="Opening the folder" shape="list" rows={6} />}
        {empty && <p className="fdlg-note">{empty}</p>}
        {current?.denied && (
          <div className="fdlg-denied">
            <p className="fdlg-note bad" role="alert">
              {current.denied}
            </p>
            {privacy && (
              <button
                type="button"
                className="btn line sm"
                onClick={() => void privacy.openFullDiskAccess()}
              >
                Open Privacy & Security
              </button>
            )}
          </div>
        )}
        {current && (
          <FolderRows
            path={current.path}
            folders={current.folders}
            projectRoots={projectRoots}
            onOpen={open}
            onParent={() => current.parent && open(current.parent)}
          />
        )}
        {picksFile && current && current.files.length > 0 && (
          <ul aria-label="Files">
            {current.files.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="fdlg-row"
                  aria-pressed={entry.path === picked}
                  onClick={() => setFile(entry.path)}
                  onDoubleClick={() => use(entry.path)}
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
        <button type="button" className="btn ghost sm" onClick={dismiss}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={!chosen || linking}
          onClick={() => chosen && use(chosen)}
        >
          {linking ? 'Linking…' : copy.use}
        </button>
      </div>
    </>
  );
  const content = (
    <>
      <div className="fdlg-head">
        <h3 id={`${ids}title`}>{copy.title}</h3>
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
      <p className="fdlg-lede" id={`${ids}lede`}>
        {lede}
      </p>
      {onCloned && mode !== 'clone-parent' && (
        <div className="fdlg-ways">
          <Segmented
            ariaLabel="How to add the project"
            options={WAYS}
            value={mode}
            onChange={(id) => setMode(id === 'clone' ? 'clone' : 'browse')}
          />
        </div>
      )}
      {onCloned && mode !== 'browse' && (
        <ClonePanel
          hidden={mode !== 'clone'}
          parent={cloneParent}
          onParentChange={setCloneParent}
          onPickParent={(current) => {
            open(current);
            setMode('clone-parent');
          }}
          onCloned={onCloned}
          onClose={onClose}
        />
      )}
      {mode !== 'clone' && browser}
    </>
  );
  const dialog = {
    ref: panelRef,
    tabIndex: -1,
    role: 'dialog',
    'aria-labelledby': `${ids}title`,
    'aria-describedby': `${ids}lede`,
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
