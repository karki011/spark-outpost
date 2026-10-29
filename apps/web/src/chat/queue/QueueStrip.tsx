import './queue.css';
import { useId, useState, type KeyboardEvent } from 'react';
import type { QueuedMessage } from '@spark-outpost/contracts';
import { ApiError } from '../../api/client.ts';
import { ArrowDownIcon, ArrowUpIcon, PenIcon, XIcon } from '../../ui/icons.tsx';
import { authorTag, canEdit, queuedCount, stripNote, type QueueMode } from './queue-model.ts';
import type { ChatQueue } from './use-chat-queue.ts';

interface QueueStripProps {
  queue: ChatQueue;
  mode: QueueMode;
}

function SendNowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function Editor({
  item,
  onSave,
  onCancel,
}: {
  item: QueuedMessage;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(item.content);
  const save = () => {
    const content = text.trim();
    if (content || item.attachmentIds?.length) onSave(content);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      save();
    }
  };
  return (
    <span className="qs-edit">
      <textarea
        aria-label="Edit queued message"
        autoFocus
        rows={Math.min(4, Math.max(1, text.split('\n').length))}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="qs-btn text"
        onClick={save}
        disabled={!text.trim() && !item.attachmentIds?.length}
      >
        Save
      </button>
      <button type="button" className="qs-btn text" onClick={onCancel}>
        Cancel
      </button>
    </span>
  );
}

function StrandedEdit({
  content,
  queue,
  onDone,
}: {
  content: string;
  queue: ChatQueue;
  onDone: () => void;
}) {
  const [text, setText] = useState(content);
  const requeue = () => {
    const kept = text.trim();
    if (kept) void queue.add(kept).then(onDone, () => undefined);
  };
  return (
    <div className="qs-stranded">
      <p className="qs-error" role="alert">
        That message was sent before your edit was saved. Queue the edit as a new message, or
        discard it.
      </p>
      <span className="qs-edit">
        <textarea
          aria-label="Unsaved edit"
          rows={Math.min(4, Math.max(1, text.split('\n').length))}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="button" className="qs-btn text" onClick={requeue} disabled={!text.trim()}>
          Queue
        </button>
        <button type="button" className="qs-btn text" onClick={onDone}>
          Discard
        </button>
      </span>
    </div>
  );
}

interface ItemProps {
  item: QueuedMessage;
  index: number;
  count: number;
  queue: ChatQueue;
  editing: boolean;
  onEdit: (id: string | null) => void;
  onSave: (content: string) => void;
}

function QueueItem({ item, index, count, queue, editing, onEdit, onSave }: ItemProps) {
  const label = `Queued message ${index + 1}`;
  const editable = canEdit(item);
  const tag = authorTag(item);
  return (
    <li className="qs-item" aria-label={label}>
      <span className="qs-n" aria-hidden="true">
        {index + 1}
      </span>
      {editing && editable ? (
        <Editor item={item} onSave={onSave} onCancel={() => onEdit(null)} />
      ) : (
        <>
          <span className="qs-text" title={item.content}>
            {item.continueRunId && <b className="qs-tag">Continue · </b>}
            {tag && <b className="qs-tag">{tag} · </b>}
            {item.content}
            {!!item.attachmentIds?.length && (
              <span className="qs-tag">
                {item.content ? ' · ' : ''}
                {item.attachmentIds.length}{' '}
                {item.attachmentIds.length === 1 ? 'attachment' : 'attachments'}
              </span>
            )}
          </span>
          <span className="qs-acts">
            {editable && (
              <button
                type="button"
                className="qs-btn"
                aria-label="Edit"
                onClick={() => onEdit(item.id)}
              >
                <PenIcon />
              </button>
            )}
            <button
              type="button"
              className="qs-btn"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => queue.move(item.id, -1)}
            >
              <ArrowUpIcon />
            </button>
            <button
              type="button"
              className="qs-btn"
              aria-label="Move down"
              disabled={index === count - 1}
              onClick={() => queue.move(item.id, 1)}
            >
              <ArrowDownIcon />
            </button>
            <button
              type="button"
              className="qs-btn now"
              aria-label="Send now"
              title="Send now: steer the running turn, or stop it and send this first"
              onClick={() => queue.sendNow(item.id)}
            >
              <SendNowIcon />
              <span className="qs-now">Send now</span>
            </button>
            <button
              type="button"
              className="qs-btn"
              aria-label="Remove"
              onClick={() => queue.remove(item.id)}
            >
              <XIcon />
            </button>
          </span>
        </>
      )}
    </li>
  );
}

export function QueueStrip({ queue, mode }: QueueStripProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [stranded, setStranded] = useState<string | null>(null);
  const headId = useId();
  const { items } = queue;
  if (items.length === 0 && stranded === null) return null;
  const save = (id: string, content: string) => {
    setEditing(null);
    queue.edit(id, content).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) setStranded(content);
    });
  };
  return (
    <div className="qwrap">
      <section className={`qstrip ${mode}`} aria-labelledby={headId}>
        <div className="qs-h">
          <b id={headId}>{queuedCount(items.length)}</b>
          {items.length > 0 && <span className="qs-note">{stripNote(mode, items)}</span>}
        </div>
        {stranded !== null && (
          <StrandedEdit content={stranded} queue={queue} onDone={() => setStranded(null)} />
        )}
        <ol className="qs-list" aria-label="Queued messages">
          {items.map((item, index) => (
            <QueueItem
              key={item.id}
              item={item}
              index={index}
              count={items.length}
              queue={queue}
              editing={editing === item.id}
              onEdit={setEditing}
              onSave={(content) => save(item.id, content)}
            />
          ))}
        </ol>
        {queue.error && stranded === null && (
          <p className="qs-error" role="alert">
            {queue.error}
          </p>
        )}
      </section>
    </div>
  );
}
