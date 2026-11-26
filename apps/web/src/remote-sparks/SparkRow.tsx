import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REMOTE_SPARK_NAME_MAX, type RemoteSpark } from '@spark-outpost/contracts';
import '../conversations/chat-menu.css';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { DotsIcon, LaptopIcon } from '../ui/icons.tsx';
import { remoteSparkKeys, remoteSparksApi } from './remote-sparks-api.ts';
import { lastOpenedLine } from './remote-sparks-copy.ts';
import { SparkStatus } from './SparkStatus.tsx';

function RenameSpark({ spark, onDone }: { spark: RemoteSpark; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(spark.name);
  const rename = useMutation({
    mutationFn: () => remoteSparksApi.rename(spark.id, name.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) rename.mutate();
  };
  return (
    <form className="ph-rename" onSubmit={submit}>
      <input
        className="inp"
        aria-label={`New name for ${spark.name}`}
        value={name}
        maxLength={REMOTE_SPARK_NAME_MAX}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
      />
      <button type="submit" className="btn primary sm" disabled={rename.isPending || !name.trim()}>
        Save
      </button>
      <button type="button" className="btn ghost sm" onClick={onDone}>
        Cancel
      </button>
      {rename.error && (
        <p className="ph-error" role="alert">
          {rename.error.message}
        </p>
      )}
    </form>
  );
}

interface SparkRowProps {
  spark: RemoteSpark;
  now: number;
  onRemove: (spark: RemoteSpark, from: HTMLButtonElement) => void;
}

export function SparkRow({ spark, now, onRemove }: SparkRowProps) {
  const queryClient = useQueryClient();
  const menuButton = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const open = useMutation({
    mutationFn: () => remoteSparksApi.open(spark.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all }),
  });
  const finishRename = () => {
    setRenaming(false);
    requestAnimationFrame(() => menuButton.current?.focus());
  };
  const closeMenu = () => {
    setAnchor(null);
    menuButton.current?.focus();
  };
  const openMenu = () => {
    const rect = menuButton.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      x: rect.right - 212,
      y: rect.bottom + 4,
      above: rect.top - 4,
      focusBack: menuButton.current,
    });
  };
  return (
    <li className="rs-row">
      <span className="ph-device-icon" aria-hidden="true">
        <LaptopIcon />
      </span>
      <div className="ph-device-body rs-body">
        {renaming ? (
          <RenameSpark spark={spark} onDone={finishRename} />
        ) : (
          <>
            <div className="ph-device-line">
              <b>{spark.name}</b>
              <SparkStatus spark={spark} />
            </div>
            <span className="ph-device-summary">
              {spark.hostname} · {lastOpenedLine(spark, now)}
            </span>
          </>
        )}
      </div>
      {!renaming && (
        <div className="rs-actions">
          <button
            type="button"
            className="btn primary sm"
            aria-label={`Open ${spark.name}`}
            disabled={open.isPending}
            onClick={() => open.mutate()}
          >
            Open
          </button>
          <button
            ref={menuButton}
            type="button"
            className="icon-btn ph-device-menu"
            aria-label={`Actions for ${spark.name}`}
            aria-haspopup="menu"
            aria-expanded={anchor !== null}
            onClick={() => (anchor ? closeMenu() : openMenu())}
          >
            <DotsIcon />
          </button>
        </div>
      )}
      {anchor && (
        <MenuShell
          anchor={anchor}
          label={`Actions for ${spark.name}`}
          page="main"
          onClose={closeMenu}
        >
          <MenuItem
            label="Rename"
            onSelect={() => {
              setAnchor(null);
              setRenaming(true);
            }}
          />
          <MenuItem
            danger
            label="Remove…"
            onSelect={() => {
              setAnchor(null);
              if (menuButton.current) onRemove(spark, menuButton.current);
            }}
          />
        </MenuShell>
      )}
      {open.error && (
        <p className="ph-error rs-row-note" role="alert">
          {open.error.message}
        </p>
      )}
    </li>
  );
}
