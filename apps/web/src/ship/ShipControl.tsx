import './ship.css';
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  preferredShipMode,
  QUIET_SHIP_BLOCKS,
  SHIP_TITLE_MAX_LENGTH,
  shipModeLabels,
  type ShipMode,
  type ShipPreview,
  type ShipResult,
} from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { taskKeys } from '../tasks/task-api.ts';
import { ticketKeys } from '../tickets/tickets-api.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { BranchIcon } from '../ui/icons.tsx';
import { shipApi, shipKeys } from './ship-api.ts';

const MODE_SHORT: Record<ShipMode, string> = {
  commit: 'Commit',
  push: 'Push',
  draft_pr: 'PR',
};

function modeLabel(mode: ShipMode, hasPullRequest: boolean): string {
  if (mode === 'draft_pr' && hasPullRequest) return 'Update PR';
  return shipModeLabels[mode];
}

function resultLine(result: ShipResult): string {
  if (result.pullRequest) {
    const verb = result.pullRequest.created ? 'Opened' : 'Updated';
    const kind = result.pullRequest.draft ? 'draft PR' : 'PR';
    return `${verb} ${kind} #${result.pullRequest.number}.`;
  }
  if (result.pushed) return `Pushed ${result.branch}.`;
  return `Committed ${result.commit?.slice(0, 7) ?? ''} on ${result.branch}.`;
}

function withShipResult(preview: ShipPreview, result: ShipResult): ShipPreview {
  const pullRequest = result.pullRequest
    ? { url: result.pullRequest.url, number: result.pullRequest.number }
    : (preview.shipped?.pullRequest ?? null);
  return {
    ...preview,
    files: [],
    modes: preview.modes.filter((mode) => mode !== 'commit'),
    shipped: {
      branch: result.branch,
      commit: result.commit ?? preview.shipped?.commit ?? null,
      pushedAt: result.pushed ? new Date().toISOString() : (preview.shipped?.pushedAt ?? null),
      pullRequest,
    },
  };
}

interface ShipPanelProps {
  id: string;
  preview: ShipPreview;
  hasPullRequest: boolean;
  busy: boolean;
  error: string | null;
  onShip: (mode: ShipMode, title: string) => void;
  onClose: () => void;
}

function ShipPanel({ id, preview, hasPullRequest, busy, error, onShip, onClose }: ShipPanelProps) {
  const [mode, setMode] = useState<ShipMode>(preferredShipMode(preview.modes) ?? 'commit');
  const [title, setTitle] = useState(preview.title);
  const titleId = useId();
  const trimmed = title.trim();
  return (
    <div
      id={id}
      className="ship-pop"
      role="group"
      aria-label="Ship this task"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {preview.modes.length > 1 && (
        <Segmented
          ariaLabel="How to ship"
          options={preview.modes.map((option) => ({ id: option, label: MODE_SHORT[option] }))}
          value={mode}
          onChange={(value) => setMode(value as ShipMode)}
        />
      )}
      <dl className="ship-facts">
        <dt>Branch</dt>
        <dd>
          <code>{preview.branch}</code>
          {mode !== 'commit' && preview.baseBranch && (
            <>
              {' '}
              into <code>{preview.baseBranch}</code>
            </>
          )}
        </dd>
        {mode !== 'commit' && preview.remote && (
          <>
            <dt>Remote</dt>
            <dd>{preview.remote.repo ?? preview.remote.name}</dd>
          </>
        )}
      </dl>
      <label className="ship-title" htmlFor={titleId}>
        {mode === 'draft_pr' ? 'Pull request title' : 'Commit title'}
      </label>
      <input
        id={titleId}
        className="inp"
        value={title}
        maxLength={SHIP_TITLE_MAX_LENGTH}
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
      />
      {preview.files.length > 0 ? (
        <ul className="ship-files" aria-label="Files to commit">
          {preview.files.map((file) => (
            <li key={file.path}>
              <code>{file.path}</code>
              <span className={`ship-change ${file.change}`}>{file.change}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ship-note">No new changes. Ship pushes the branch as it is.</p>
      )}
      {preview.notes.map((note) => (
        <p key={note} className="ship-note">
          {note}
        </p>
      ))}
      <div className="ship-acts">
        <button
          type="button"
          className="btn primary sm"
          disabled={busy || !trimmed}
          onClick={() => onShip(mode, trimmed)}
        >
          {busy ? 'Shipping…' : modeLabel(mode, hasPullRequest)}
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="ship-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ShipControl({
  taskId,
  conversationId,
}: {
  taskId: string;
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ShipResult | null>(null);

  useEffect(() => {
    if (result) (buttonRef.current ?? doneRef.current)?.focus();
  }, [result]);
  const preview = useQuery({
    queryKey: shipKeys.preview(taskId),
    queryFn: () => shipApi.preview(taskId),
  });
  const ship = useMutation({
    mutationFn: ({ mode, title }: { mode: ShipMode; title: string }) =>
      shipApi.ship(taskId, { mode, title }),
    onSuccess: async (shipped) => {
      setResult(shipped);
      setOpen(false);
      queryClient.setQueryData<ShipPreview>(shipKeys.preview(taskId), (current) =>
        current ? withShipResult(current, shipped) : current,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shipKeys.preview(taskId) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.task(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
        queryClient.invalidateQueries({ queryKey: ticketKeys.all }),
      ]);
    },
  });
  const close = () => {
    setOpen(false);
    ship.reset();
    buttonRef.current?.focus();
  };

  const data = preview.data;
  if (!data) return null;
  const mode = preferredShipMode(data.modes);
  const pull = result?.pullRequest ?? data.shipped?.pullRequest ?? null;
  return (
    <div className="ship">
      {result && (
        <p ref={doneRef} className="ship-done" role="status" tabIndex={-1}>
          {resultLine(result)}
        </p>
      )}
      {result?.prLink && !pull && (
        <a className="btn primary sm" href={result.prLink.url} target="_blank" rel="noreferrer">
          {result.prLink.label}
        </a>
      )}
      {data.blocked && !pull && !QUIET_SHIP_BLOCKS.includes(data.blocked.reason) && (
        <p className="ship-note">{data.blocked.message}</p>
      )}
      {mode && (
        <button
          ref={buttonRef}
          type="button"
          className={open ? 'btn line sm ship-btn' : 'btn primary sm ship-btn'}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <BranchIcon />
          {modeLabel(mode, pull !== null)}
        </button>
      )}
      {open && (
        <ShipPanel
          id={panelId}
          preview={data}
          hasPullRequest={pull !== null}
          busy={ship.isPending}
          error={ship.error?.message ?? null}
          onShip={(chosen, title) => ship.mutate({ mode: chosen, title })}
          onClose={close}
        />
      )}
    </div>
  );
}
