import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { diffApi, diffKeys } from '../diff/diff-api.ts';
import { ChangeCount } from './ActivityLog.tsx';
import { baseName, type LineChange } from './home-model.ts';
import { PEEK_FILE_LINES } from './island-diff.ts';
import { IslandDiff } from './IslandDiff.tsx';
import { Kbd } from './island-parts.tsx';

export interface PeekTarget {
  chatId: string;
  taskId: string;
  version: string | undefined;
  change: LineChange;
}

interface DiffPeekProps {
  target: PeekTarget;
  onBack: () => void;
  onOpenChat: (chatId: string, runId: string) => void;
}

function folderOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

export function DiffPeek({ target, onBack, onOpenChat }: DiffPeekProps) {
  const { change, taskId, version } = target;
  const backRef = useRef<HTMLButtonElement>(null);
  const params = { version, runId: change.runId, path: change.path, lines: PEEK_FILE_LINES };
  const file = useQuery({
    queryKey: diffKeys.file(taskId, params),
    queryFn: () => diffApi.file(taskId, params),
  });
  const name = baseName(change.path);
  const folder = folderOf(change.path);

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  };

  const data = file.data;
  return (
    <div className="isl-pd" role="group" aria-label={`Change to ${name}`} onKeyDown={onKeyDown}>
      <div className="isl-pd-head">
        <button
          ref={backRef}
          type="button"
          className="isl-back isl-pd-back"
          aria-label="Back to steps"
          onClick={onBack}
        >
          ‹ Steps
        </button>
        <b className="isl-pd-name">{name}</b>
        {folder && <span className="isl-pd-path">{folder}</span>}
        <span className="isl-sp" />
        <ChangeCount added={change.added} removed={change.removed} />
      </div>
      {file.isPending && (
        <div className="isl-skl" aria-hidden="true">
          <i />
          <i style={{ width: '64%' }} />
        </div>
      )}
      {file.isError && (
        <p className="isl-now-status" role="status">
          This change can’t be shown right now.
        </p>
      )}
      {data && data.newText === null && (
        <p className="isl-now-status" role="status">
          This file is too large or not text. Open the chat to review it.
        </p>
      )}
      {data && data.newText !== null && (
        <IslandDiff
          diff={{ path: data.path, oldText: data.oldText, newText: data.newText }}
          mode="peek"
          label={`Changes to ${name}`}
        />
      )}
      {data?.limited && (
        <p className="isl-hint">Showing the first {PEEK_FILE_LINES} lines of the file.</p>
      )}
      <div className="isl-acts">
        <button
          type="button"
          className="isl-btn"
          onClick={() => onOpenChat(target.chatId, change.runId)}
        >
          Open chat
        </button>
        <span className="isl-pd-keys" aria-hidden="true">
          <Kbd>Esc</Kbd> back
        </span>
      </div>
    </div>
  );
}
