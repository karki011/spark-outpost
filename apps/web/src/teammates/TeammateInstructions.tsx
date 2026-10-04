import { useId, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { TEAMMATE_INSTRUCTIONS_MAX } from '@spark-outpost/contracts';
import { formatBytes } from '../api/attachments.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { FileIcon } from '../chat/attachments/attachment-icons.tsx';
import { FolderDialog } from '../chat/project/FolderDialog.tsx';
import { XIcon } from '../ui/icons.tsx';

interface TeammateInstructionsProps {
  instructions: string;
  path: string | null;
  onInstructions: (instructions: string) => void;
  onPath: (path: string | null) => void;
}

const LIMIT = TEAMMATE_INSTRUCTIONS_MAX.toLocaleString('en-US');

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

function folderOf(path: string | null): string | null {
  return path ? path.slice(0, path.lastIndexOf('/')) || '/' : null;
}

function InstructionsFileCard({ path, onRemove }: { path: string; onRemove: () => void }) {
  const file = useQuery({
    queryKey: projectKeys.instructionsFile(path),
    queryFn: () => projectsApi.instructionsFile(path),
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const problem = file.data?.problem ?? (file.isError ? file.error.message : null);
  return (
    <div className="tm-file" role="group" aria-label="Instructions file">
      <div className="tm-file-h">
        <FileIcon />
        <span className="tm-file-name" title={path}>
          {fileName(path)}
        </span>
        {file.data?.sizeBytes != null && <small>{formatBytes(file.data.sizeBytes)}</small>}
        <button
          type="button"
          className="icon-btn"
          aria-label="Remove instructions file"
          title="Remove instructions file"
          onClick={onRemove}
        >
          <XIcon />
        </button>
      </div>
      <p className="tm-file-path">{path}</p>
      {problem && (
        <p className="tm-file-problem" role="status">
          {problem} Chats use the typed instructions below until the file can be read.
        </p>
      )}
      {file.data && !problem && (
        <>
          <pre className="tm-file-preview" tabIndex={0} aria-label="File preview">
            {file.data.text || 'This file is empty, so chats use the typed instructions below.'}
          </pre>
          {file.data.truncated && (
            <p className="tm-file-cut" role="status">
              Cut at {LIMIT} characters. Spark uses only the part shown.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function TeammateInstructions({
  instructions,
  path,
  onInstructions,
  onPath,
}: TeammateInstructionsProps) {
  const id = useId();
  const browseRef = useRef<HTMLButtonElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const used = instructions.length;
  const close = () => {
    setBrowsing(false);
    browseRef.current?.focus();
  };
  return (
    <div className="field">
      <div className="tm-instructions-h">
        <label htmlFor={`${id}-text`}>Standing instructions</label>
        <button
          ref={browseRef}
          type="button"
          className="btn line sm"
          onClick={() => setBrowsing(true)}
        >
          <FileIcon />
          {path ? 'Change file…' : 'Use a file…'}
        </button>
      </div>
      {path && <InstructionsFileCard path={path} onRemove={() => onPath(null)} />}
      <textarea
        id={`${id}-text`}
        className="inp tm-instructions"
        rows={path ? 3 : 6}
        value={instructions}
        placeholder="Review for bugs and missing tests. Point to the file and line."
        aria-describedby={`${id}-count`}
        onChange={(event) => onInstructions(event.target.value)}
      />
      <small
        id={`${id}-count`}
        className={used > TEAMMATE_INSTRUCTIONS_MAX ? 'tm-count over' : 'tm-count'}
      >
        {path
          ? 'The file is read at the start of each chat and used instead of this text. This text is the fallback if the file can’t be read.'
          : 'Added to every chat with this Spark as your own instructions. Type them here or point to a file; a file is used instead of typed text.'}{' '}
        {used} / {TEAMMATE_INSTRUCTIONS_MAX}
      </small>
      <AnimatePresence>
        {browsing && (
          <FolderDialog
            key="files"
            purpose="instructions"
            startPath={folderOf(path)}
            linking={false}
            error={null}
            onUse={(picked) => {
              onPath(picked);
              close();
            }}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
