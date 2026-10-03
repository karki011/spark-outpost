import { memo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { motion } from 'motion/react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { categoryLabel, type ConversationSummary } from '@spark-outpost/contracts';
import { DotsIcon, GripIcon, PinIcon, RestoreIcon, TrashIcon } from '../ui/icons.tsx';
import { reveal } from '../ui/transitions.tsx';
import { recencyLabel } from './recency.ts';
import { rowState, type RowTone } from './row-state.ts';
import { RowTitle, useMarquee } from './RowTitle.tsx';
import { useSortableMotion } from './use-sortable-motion.ts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { pointerStart } from './sidebar-dnd-geometry.ts';

interface ChatRowProps {
  chat: ConversationSummary;
  selected: boolean;
  renaming: boolean;
  sortable: boolean;
  settling: boolean;
  flash: boolean;
  index: number;
  onOpen: (id: string) => void;
  onMenu: (id: string, element: HTMLElement, point: { x: number; y: number } | null) => void;
  onRename: (chat: ConversationSummary, title: string | null) => void;
  onRestore: (chat: ConversationSummary) => void;
  onDelete: (chat: ConversationSummary) => void;
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
}: {
  title: string;
  onRestore: () => void;
  onDelete: () => void;
}) {
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

export const ChatRow = memo(function ChatRow(props: ChatRowProps) {
  const { chat, selected, renaming, sortable, settling, flash, onOpen, onMenu, onRename } = props;
  const history = chat.archivedAt !== null;
  const draggable = sortable && !renaming && !history;
  const slide = useSortableMotion();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: chat.id,
    data: { type: 'chat', chatId: chat.id, pinned: chat.pinnedAt !== null },
    disabled: !draggable,
    ...slide,
  });
  const marquee = useMarquee(chat.title);
  const state = rowState(chat, selected);
  const [firstTone] = useState(state.tone);
  const classes = [
    'row',
    `st-${state.tone}`,
    selected ? 'active' : '',
    isDragging ? 'placeholder' : '',
    flash ? 'flash' : '',
    chat.pinnedAt ? 'pinned' : '',
  ].filter(Boolean);
  const pointerListeners = pointerStart(listeners, draggable);

  const openMenuAt = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    if ((event.nativeEvent as globalThis.PointerEvent).pointerType === 'touch') return;
    onMenu(chat.id, event.currentTarget, { x: event.clientX, y: event.clientY });
  };

  const rootProps = {
    ref: setNodeRef,
    className: classes.join(' '),
    style: { transform: CSS.Translate.toString(transform), transition: transition },
    'data-chat': chat.id,
    onContextMenu: renaming ? undefined : openMenuAt,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') marquee.start();
    },
    onPointerLeave: marquee.stop,
  };
  const tooltip = [
    chat.title,
    chat.teammate ? `with ${chat.teammate.name}` : null,
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
            <RenameInput
              title={chat.title}
              label="Chat name"
              onDone={(title) => onRename(chat, title)}
            />
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="row-open"
          aria-current={selected ? 'page' : undefined}
          title={tooltip.join(' · ')}
          onClick={() => onOpen(chat.id)}
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) marquee.start();
          }}
          onBlur={marquee.stop}
          {...pointerListeners}
        >
          <span
            key={state.tone}
            className={`st${state.tone !== firstTone ? ' enter' : ''}`}
            role={state.label ? 'img' : undefined}
            aria-label={state.label || undefined}
          >
            <StatusMark tone={state.tone} />
          </span>
          {chat.teammate && (
            <span className="rface" aria-hidden="true">
              <TeammateFace face={chat.teammate.face} size={16} />
            </span>
          )}
          <span className="rt">
            <RowTitle
              text={chat.title}
              overflow={marquee.overflow}
              running={marquee.running}
              titleRef={marquee.ref}
            />
            {state.sub && <small className="sub">{state.sub}</small>}
            {chat.teammate && <span className="sr-only">with {chat.teammate.name}</span>}
          </span>
        </button>
      )}
      {history ? (
        <HistoryActions
          title={chat.title}
          onRestore={() => props.onRestore(chat)}
          onDelete={() => props.onDelete(chat)}
        />
      ) : (
        !renaming && (
          <>
            {chat.pinnedAt && (
              <span className="rpin" role="img" aria-label="Pinned">
                <PinIcon />
              </span>
            )}
            {draggable && (
              <button
                type="button"
                ref={setActivatorNodeRef}
                className="icon-btn rgrip"
                title="Drag to move"
                {...attributes}
                {...listeners}
                aria-label={`Move ${chat.title}`}
              >
                <GripIcon />
              </button>
            )}
            <button
              type="button"
              className="icon-btn rmenu"
              aria-label={`Options for ${chat.title}`}
              aria-haspopup="menu"
              onClick={(event) => onMenu(chat.id, event.currentTarget, null)}
            >
              <DotsIcon />
            </button>
          </>
        )
      )}
    </>
  );

  return (
    <motion.li
      layout={settling ? false : 'position'}
      layoutDependency={props.index}
      initial={false}
      transition={reveal}
      {...rootProps}
    >
      {content}
    </motion.li>
  );
});
