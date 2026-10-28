import './queue.css';
import { useId, useState, type KeyboardEvent } from 'react';
import type { QueuedMessage } from '@spark-outpost/contracts';
import { ArrowDownIcon, ArrowUpIcon, PenIcon, XIcon } from '../../ui/icons.tsx';
import { canEdit, queuedCount, queueNote, type QueueMode } from './queue-model.ts';
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

interface ItemProps {
  item: QueuedMessage;
  index: number;
  count: number;
  queue: ChatQueue;
  editing: boolean;
  onEdit: (id: string | null) => void;
}

function QueueItem({ item, index, count, queue, editing, onEdit }: ItemProps) {
  const label = `Queued message ${index + 1}`;
  const editable = canEdit(item);
  return (
    <li className="qs-item" aria-label={label}>
      <span className="qs-n" aria-hidden="true">
        {index + 1}
      </span>
      {editing && editable ? (
        <Editor
          item={item}
          onSave={(content) => {
            queue.edit(item.id, content);
            onEdit(null);
          }}
          onCancel={() => onEdit(null)}
        />
      ) : (
        <>
          <span className="qs-text" title={item.content}>
            {item.continueRunId && <b className="qs-tag">Continue · </b>}
            {!editable && <b className="qs-tag">Outpost request · </b>}
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
  const headId = useId();
  const { items } = queue;
  if (items.length === 0) return null;
  return (
    <div className="qwrap">
      <section className={`qstrip ${mode}`} aria-labelledby={headId}>
        <div className="qs-h">
          <b id={headId}>{queuedCount(items.length)}</b>
          <span className="qs-note">{queueNote(mode, items.length)}</span>
        </div>
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
            />
          ))}
        </ol>
        {queue.error && (
          <p className="qs-error" role="alert">
            {queue.error}
          </p>
        )}
      </section>
    </div>
  );
}
