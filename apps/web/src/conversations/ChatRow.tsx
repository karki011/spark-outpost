import { memo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { motion } from 'motion/react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { categoryLabel, type ConversationSummary } from '@spark-outpost/contracts';
import { DotsIcon, GripIcon, MergedIcon, PinIcon, RestoreIcon, TrashIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { reveal } from '../ui/transitions.tsx';
import { MatchSnippet } from './MatchSnippet.tsx';
import { recencyLabel } from './recency.ts';
import { rowFaceState, rowState } from './row-state.ts';
import { chatBlob } from './chat-blob.ts';
import { ChatBlob } from './ChatBlob.tsx';
import { useChatOnScreen } from './on-screen.ts';
import { RowTitle, useMarquee } from './RowTitle.tsx';
import { useSortableMotion } from './use-sortable-motion.ts';
import { RowFace } from './RowFace.tsx';
import { pointerStart } from './sidebar-dnd-geometry.ts';

interface ChatRowProps {
  chat: ConversationSummary;
  selected: boolean;
  renaming: boolean;
  sortable: boolean;
  settling: boolean;
  flash: boolean;
  index: number;
  handle?: string | undefined;
  onOpen: (id: string) => void;
  onMenu: (id: string, element: HTMLElement, point: { x: number; y: number } | null) => void;
  onRename: (chat: ConversationSummary, title: string | null) => void;
  onRestore: (chat: ConversationSummary) => void;
  onDelete: (chat: ConversationSummary) => void;
}

const MERGED_LABEL = 'Pull request merged';

function MergedMark() {
  const tip = useTooltip(MERGED_LABEL);
  return (
    <>
      <span
        className="row-merged"
        role="img"
        aria-label={MERGED_LABEL}
        title=""
        {...tip.triggerProps}
      >
        <MergedIcon />
      </span>
      {tip.tooltip}
    </>
  );
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
  const { chat, selected, renaming, sortable, settling, flash, handle } = props;
  const { onOpen, onMenu, onRename } = props;
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
  const onScreen = useChatOnScreen(chat.id);
  const blob = chatBlob(chat, onScreen);
  const face = <RowFace chat={chat} state={rowFaceState(chat, state.tone)} />;
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
  const terminal = chat.sessionType === 'terminal';
  const tooltip = [
    chat.title,
    terminal ? 'Terminal session' : null,
    handle ? `@${handle}` : null,
    chat.teammate ? `with ${chat.teammate.name}` : null,
    chat.titleSource === 'auto' ? 'Renamed by Spark' : null,
    chat.category ? categoryLabel(chat.category) : null,
    state.label,
    chat.pullRequestMerged ? MERGED_LABEL : null,
    recencyLabel(chat.updatedAt),
  ].filter(Boolean);
  const content = (
    <>
      {renaming ? (
        <div className="row-open">
          <span className="st">{face}</span>
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
          <span className="st">{face}</span>
          <span className="rt">
            <span className="row-title-line">
              <RowTitle
                text={chat.title}
                overflow={marquee.overflow}
                running={marquee.running}
                titleRef={marquee.ref}
              />
              {chat.pullRequestMerged && <MergedMark />}
            </span>
            {handle && <span className="sr-only">{`, @${handle}`}</span>}
            {terminal && <span className="sr-only">, Terminal session</span>}
            {chat.match && <MatchSnippet match={chat.match} />}
            {chat.teammate && <span className="sr-only">with {chat.teammate.name}</span>}
          </span>
          <ChatBlob kind={blob} />
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
