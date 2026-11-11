import './start-context.css';
import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TICKET_START_NOTE_MAX_LENGTH } from '@spark-outpost/contracts';
import { AttachmentChips } from '../chat/attachments/AttachmentChips.tsx';
import { FileIcon } from '../chat/attachments/attachment-icons.tsx';
import { LinkIcon } from '../tasks/TaskIcons.tsx';
import { ChevronIcon, FolderIcon, PlusIcon, XIcon } from '../ui/icons.tsx';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { reveal } from '../ui/transitions.tsx';
import type { StartContextState } from './use-start-context.ts';

interface StartContextProps {
  context: StartContextState;
  open: boolean;
  onToggle: () => void;
  onBrowseFolder: () => void;
  onSendAnyway: () => void;
}

function RefChip({
  icon,
  label,
  title,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  onRemove: () => void;
}) {
  return (
    <li className="chip tk-ctx-chip" title={title}>
      {icon}
      <span className="att-name">{label}</span>
      <button type="button" className="chip-x" aria-label={`Remove ${label}`} onClick={onRemove}>
        <XIcon />
      </button>
    </li>
  );
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function hasFolder(event: DragEvent<HTMLElement>): boolean {
  return [...event.dataTransfer.items].some((item) => item.webkitGetAsEntry?.()?.isDirectory);
}

export function StartContext({
  context,
  open,
  onToggle,
  onBrowseFolder,
  onSendAnyway,
}: StartContextProps) {
  const bodyId = useId();
  const noteId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const { files } = context;

  const addLink = () => {
    if (!link.trim()) return;
    const problem = context.addLink(link);
    setLinkError(problem);
    if (!problem) setLink('');
  };

  const onLinkKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addLink();
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (hasFolder(event)) files.notify('Use Add folder to reference a folder by its path.');
    const dropped = [...event.dataTransfer.items]
      .filter((item) => item.kind === 'file' && !item.webkitGetAsEntry?.()?.isDirectory)
      .flatMap((item) => item.getAsFile() ?? []);
    files.add(dropped);
  };

  return (
    <div className="tk-ctx">
      <button
        type="button"
        className="tk-ctx-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <PlusIcon />
        <span className="tk-ctx-title">Add context</span>
        <span className="tk-ctx-hint">
          {context.count > 0 ? `· ${context.count} added` : '· note, links, files, folders'}
        </span>
        <ChevronIcon />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            className={dragging ? 'tk-ctx-body dragging' : 'tk-ctx-body'}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={reveal}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <label className="tk-ctx-label" htmlFor={noteId}>
              Note
            </label>
            <textarea
              id={noteId}
              ref={noteRef}
              className="inp tk-ctx-note"
              rows={3}
              maxLength={TICKET_START_NOTE_MAX_LENGTH}
              placeholder="Anything else Spark should know?"
              value={context.note}
              onChange={(event) => context.setNote(event.target.value)}
            />
            <SecretWarning
              guard={context.secrets}
              input={noteRef}
              onText={context.setNote}
              onSendAnyway={onSendAnyway}
            />
            <div className="tk-ctx-link">
              <input
                className="inp"
                type="url"
                inputMode="url"
                aria-label="Link URL"
                aria-invalid={linkError ? true : undefined}
                placeholder="Paste a link, such as a spec or design"
                value={link}
                onChange={(event) => {
                  setLink(event.target.value);
                  setLinkError(null);
                }}
                onKeyDown={onLinkKey}
              />
              <button
                type="button"
                className="btn line sm"
                onClick={addLink}
                disabled={!link.trim()}
              >
                Add link
              </button>
            </div>
            {linkError && (
              <p className="tk-cform-err" role="alert">
                {linkError}
              </p>
            )}
            <div className="tk-ctx-actions">
              <button
                type="button"
                className="btn line sm"
                onClick={() => fileInput.current?.click()}
              >
                <FileIcon />
                Add files
              </button>
              <button type="button" className="btn line sm" onClick={onBrowseFolder}>
                <FolderIcon />
                Add folder
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                aria-label="Add files"
                onChange={(event) => {
                  files.add(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </div>
            {(context.links.length > 0 || context.folders.length > 0) && (
              <ul className="tk-ctx-chips" aria-label="References">
                {context.links.map((url) => (
                  <RefChip
                    key={url}
                    icon={<LinkIcon />}
                    label={url}
                    title={url}
                    onRemove={() => context.removeLink(url)}
                  />
                ))}
                {context.folders.map((path) => (
                  <RefChip
                    key={path}
                    icon={<FolderIcon />}
                    label={folderName(path)}
                    title={path}
                    onRemove={() => context.removeFolder(path)}
                  />
                ))}
              </ul>
            )}
            <AttachmentChips items={files.items} onRemove={files.remove} onRetry={files.retry} />
            {files.notice && (
              <p className="tk-ctx-tip" role="status">
                {files.notice}
              </p>
            )}
            <p className="tk-ctx-tip">
              Drop files here. Folders are referenced by path and read by the agent with its tools,
              never copied in.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
