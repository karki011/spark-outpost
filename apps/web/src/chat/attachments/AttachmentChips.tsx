import './attachments.css';
import { AnimatePresence, motion } from 'motion/react';
import { formatBytes } from '../../api/attachments.ts';
import { XIcon } from '../../ui/icons.tsx';
import { reveal } from '../../ui/transitions.tsx';
import { FileIcon, ProgressRing, RetryIcon } from './attachment-icons.tsx';
import type { PendingAttachment } from './use-attachments.ts';

interface AttachmentChipsProps {
  items: PendingAttachment[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}

const chipMotion = {
  layout: true,
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.8 },
  transition: reveal,
} as const;

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className="chip-x" aria-label={`Remove ${name}`} onClick={onClick}>
      <XIcon />
    </button>
  );
}

function ImageTile({ item, onRemove }: { item: PendingAttachment; onRemove: () => void }) {
  const uploading = item.status === 'uploading';
  return (
    <div
      className={uploading ? 'att-tile uploading' : 'att-tile'}
      aria-busy={uploading}
      title={item.name}
    >
      {item.previewUrl && <img src={item.previewUrl} alt={item.name} />}
      {uploading && (
        <span className="att-veil">
          <ProgressRing progress={item.progress} label={`Uploading ${item.name}`} />
        </span>
      )}
      <RemoveButton name={item.name} onClick={onRemove} />
    </div>
  );
}

function FileChip({
  item,
  onRemove,
  onRetry,
}: {
  item: PendingAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const failed = item.status === 'error';
  const uploading = item.status === 'uploading';
  return (
    <div
      className={failed ? 'chip att-chip failed' : 'chip att-chip'}
      aria-busy={uploading}
      title={item.source.type === 'repo' ? item.source.path : undefined}
    >
      {uploading ? (
        <ProgressRing progress={item.progress} label={`Uploading ${item.name}`} />
      ) : (
        <FileIcon />
      )}
      <span className="att-name">{item.name}</span>
      <small>{failed ? item.error : formatBytes(item.size)}</small>
      {failed && item.retryable && (
        <button
          type="button"
          className="chip-x"
          aria-label={`Retry ${item.name}`}
          onClick={onRetry}
        >
          <RetryIcon />
        </button>
      )}
      <RemoveButton name={item.name} onClick={onRemove} />
    </div>
  );
}

export function AttachmentChips({ items, onRemove, onRetry }: AttachmentChipsProps) {
  return (
    <div className="chips" aria-label="Attachments" role="group">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div key={item.key} className="chip-slot" {...chipMotion}>
            {item.kind === 'image' && item.status !== 'error' ? (
              <ImageTile item={item} onRemove={() => onRemove(item.key)} />
            ) : (
              <FileChip
                item={item}
                onRemove={() => onRemove(item.key)}
                onRetry={() => onRetry(item.key)}
              />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
