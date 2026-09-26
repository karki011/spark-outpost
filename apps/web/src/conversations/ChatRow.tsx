import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { motion, Reorder, useDragControls } from 'motion/react';
import { categoryLabel, type ConversationSummary } from '@spark-outpost/contracts';
import { DotsIcon, PinIcon, RestoreIcon, TrashIcon } from '../ui/icons.tsx';
import { reveal } from '../ui/transitions.tsx';
import { recencyLabel } from './recency.ts';
import { rowState, type RowTone } from './row-state.ts';
import { RowTitle, useMarquee } from './RowTitle.tsx';

interface ChatRowProps {
  chat: ConversationSummary;
  selected: boolean;
  renaming: boolean;
  dragging: boolean;
  flash: boolean;
  onOpen: () => void;
  onMenu: (element: HTMLElement, point: { x: number; y: number } | null) => void;
  onRename: (title: string | null) => void;
  onRestore: () => void;
  onDelete: () => void;
  onDragStart: (event: PointerEvent<HTMLElement>) => void;
  onReorderEnd?: (() => void) | undefined;
}

function StatusMark({ tone }: { tone: RowTone }) {
  if (tone === 'running') return <i className="orb" />;
  if (tone === 'asking') return <i className="ask" />;
  if (tone === 'permission') return <i className="dia" />;
  if (tone === 'error') return <i className="errdot">!</i>;
  if (tone === 'done') {
    return (
      <>
        <svg
          className="dchk"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12 5 5 9-10" />
        </svg>
        <i className="udot" />
      </>
    );
  }
  return null;
}

interface RenameInputProps {
  title: string;
  label: string;
  onDone: (title: string | null) => void;
}

export function RenameInput({ title, label, onDone }: RenameInputProps) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    const trimmed = value?.trim() ?? '';
    onDone(trimmed && trimmed !== title ? trimmed : null);
  };
  return (
    <input
      className="rename"
      defaultValue={title}
      aria-label={label}
      maxLength={100}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(event.currentTarget.value);
        if (event.key === 'Escape') finish(null);
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}

function HistoryActions({
  title,
  onRestore,
  onDelete,
}: Pick<ChatRowProps, 'onRestore' | 'onDelete'> & { title: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="ract">
      <button
        type="button"
        className="icon-btn"
        aria-label={`Restore ${title}`}
        title="Restore to Active"
        onClick={onRestore}
      >
        <RestoreIcon />
      </button>
      <button
        type="button"
        className={confirming ? 'confirm-del' : 'icon-btn'}
        aria-label={confirming ? `Confirm delete ${title}` : `Delete ${title}`}
        title={confirming ? 'Click again to delete' : 'Delete'}
        onClick={() => (confirming ? onDelete() : setConfirming(true))}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? 'Delete' : <TrashIcon />}
      </button>
    </span>
  );
}

export function ChatRow(props: ChatRowProps) {
  const { chat, selected, renaming, dragging, flash, onOpen, onMenu, onRename, onReorderEnd } =
    props;
  const controls = useDragControls();
  const marquee = useMarquee(chat.title);
  const state = rowState(chat, selected);
  const [firstTone] = useState(state.tone);
  const history = chat.archivedAt !== null;
  const classes = [
    'row',
    `st-${state.tone}`,
    selected ? 'active' : '',
    dragging ? 'dragging' : '',
    flash ? 'flash' : '',
    chat.pinnedAt ? 'pinned' : '',
  ].filter(Boolean);

  const openMenuAt = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    if ((event.nativeEvent as globalThis.PointerEvent).pointerType === 'touch') return;
    onMenu(event.currentTarget, { x: event.clientX, y: event.clientY });
  };

  const rootProps = {
    className: classes.join(' '),
    'data-chat': chat.id,
    onContextMenu: renaming ? undefined : openMenuAt,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') marquee.start();
    },
    onPointerLeave: marquee.stop,
  };
  const tooltip = [
    chat.title,
    chat.titleSource === 'auto' ? 'Renamed by Spark' : null,
    chat.category ? categoryLabel(chat.category) : null,
    state.label,
    recencyLabel(chat.updatedAt),
  ].filter(Boolean);
  const content = (
    <>
      {renaming ? (
        <div className="row-open">
          <span className="st" />
          <span className="rt">
            <RenameInput title={chat.title} label="Chat name" onDone={onRename} />
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="row-open"
          aria-current={selected ? 'page' : undefined}
          title={tooltip.join(' · ')}
          onClick={onOpen}
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) marquee.start();
          }}
          onBlur={marquee.stop}
          onPointerDown={history ? undefined : props.onDragStart}
        >
          <span
            key={state.tone}
            className={`st${state.tone !== firstTone ? ' enter' : ''}`}
            role={state.label ? 'img' : undefined}
            aria-label={state.label || undefined}
          >
            <StatusMark tone={state.tone} />
          </span>
          <span className="rt">
            <RowTitle
              text={chat.title}
              overflow={marquee.overflow}
              running={marquee.running}
              titleRef={marquee.ref}
            />
            {state.sub && <small className="sub">{state.sub}</small>}
          </span>
        </button>
      )}
      {history ? (
        <HistoryActions title={chat.title} onRestore={props.onRestore} onDelete={props.onDelete} />
      ) : (
        !renaming && (
          <>
            {chat.pinnedAt && (
              <span className="rpin" role="img" aria-label="Pinned">
                <PinIcon />
              </span>
            )}
            {onReorderEnd && (
              <span
                className="rgrip"
                aria-hidden="true"
                title="Drag to reorder"
                onPointerDown={(event) => {
                  event.preventDefault();
                  controls.start(event);
                }}
              >
                <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                  <circle cx="2" cy="2" r="1.1" />
                  <circle cx="6" cy="2" r="1.1" />
                  <circle cx="2" cy="6" r="1.1" />
                  <circle cx="6" cy="6" r="1.1" />
                  <circle cx="2" cy="10" r="1.1" />
                  <circle cx="6" cy="10" r="1.1" />
                </svg>
              </span>
            )}
            <button
              type="button"
              className="icon-btn rmenu"
              aria-label={`Options for ${chat.title}`}
              aria-haspopup="menu"
              onClick={(event) => onMenu(event.currentTarget, null)}
            >
              <DotsIcon />
            </button>
          </>
        )
      )}
    </>
  );

  if (onReorderEnd) {
    return (
      <Reorder.Item
        as="li"
        value={chat.id}
        dragListener={false}
        dragControls={controls}
        transition={reveal}
        onDragEnd={onReorderEnd}
        {...rootProps}
      >
        {content}
      </Reorder.Item>
    );
  }

  return (
    <motion.li layout="position" initial={false} transition={reveal} {...rootProps}>
      {content}
    </motion.li>
  );
}
