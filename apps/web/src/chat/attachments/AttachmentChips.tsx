import './attachments.css';
import { slackPlaceLabel } from '@spark-outpost/contracts';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { formatBytes } from '../../api/attachments.ts';
import { api, queryKeys } from '../../api/client.ts';
import { allowSlackPlaceLabel } from '../../slack/slack-api.ts';
import { XIcon } from '../../ui/icons.tsx';
import { reveal } from '../../ui/transitions.tsx';
import { FileIcon, ProgressRing, RetryIcon } from './attachment-icons.tsx';
import { sharedChatView } from './shared-chat.ts';
import type { PendingAttachment } from './use-attachments.ts';

interface AttachmentChipsProps {
  items: PendingAttachment[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  onAllowSlackChannel?: (key: string) => void;
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

function slackPlace(channel: Parameters<typeof slackPlaceLabel>[0]): string {
  const label = slackPlaceLabel(channel);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function slackTitle(item: PendingAttachment): string | undefined {
  const { slack } = item;
  if (!slack) return undefined;
  const when = slack.postedAt ? ` · ${new Date(slack.postedAt).toLocaleString()}` : '';
  return `${slackPlace(slack.channel)} · ${slack.author}${when}\n${slack.firstLine}`;
}

function SlackDetail({ item }: { item: PendingAttachment }) {
  const { slack } = item;
  if (!slack) return <small>Reading the thread…</small>;
  return (
    <small className="att-slack">
      {slackPlace(slack.channel)} · {slack.author} · {slack.firstLine}
    </small>
  );
}

function ChatChip({ item, onRemove }: { item: PendingAttachment; onRemove: () => void }) {
  const chats = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  const view = item.chat ? sharedChatView(item.chat, chats.data) : null;
  return (
    <div
      className="chip att-chip"
      aria-busy={view === null}
      data-chat={view?.tone ?? 'loading'}
      title={view ? `${view.title}\n${view.project} · ${view.state}` : undefined}
    >
      {view ? <FileIcon /> : <ProgressRing progress={0} label="Reading the chat" />}
      <span className="att-name">{view?.title ?? item.name}</span>
      {view ? (
        <small className="att-slack">
          {view.project} · <b className="att-state">{view.state}</b>
        </small>
      ) : (
        <small>Reading the chat…</small>
      )}
      <RemoveButton name={view?.title ?? item.name} onClick={onRemove} />
    </div>
  );
}

function FileChip({
  item,
  onRemove,
  onRetry,
  onAllow,
}: {
  item: PendingAttachment;
  onRemove: () => void;
  onRetry: () => void;
  onAllow?: (() => void) | undefined;
}) {
  const failed = item.status === 'error';
  const uploading = item.status === 'uploading';
  return (
    <div
      className={failed ? 'chip att-chip failed' : 'chip att-chip'}
      aria-busy={uploading}
      title={item.source.type === 'repo' ? item.source.path : slackTitle(item)}
      data-slack={item.source.type === 'slack' || undefined}
    >
      {uploading ? (
        <ProgressRing progress={item.progress} label={`Uploading ${item.name}`} />
      ) : (
        <FileIcon />
      )}
      <span className="att-name">{item.name}</span>
      {item.source.type === 'slack' && !failed ? (
        <SlackDetail item={item} />
      ) : (
        <small>{failed ? item.error : formatBytes(item.size)}</small>
      )}
      {failed && item.blockedChannel && onAllow && (
        <button type="button" className="btn line sm" onClick={onAllow}>
          {allowSlackPlaceLabel(item.blockedChannel)}
        </button>
      )}
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

export function AttachmentChips({
  items,
  onRemove,
  onRetry,
  onAllowSlackChannel,
}: AttachmentChipsProps) {
  return (
    <div className="chips" aria-label="Attachments" role="group">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div key={item.key} className="chip-slot" {...chipMotion}>
            {item.kind === 'image' && item.status !== 'error' ? (
              <ImageTile item={item} onRemove={() => onRemove(item.key)} />
            ) : item.source.type === 'chat' && item.status !== 'error' ? (
              <ChatChip item={item} onRemove={() => onRemove(item.key)} />
            ) : (
              <FileChip
                item={item}
                onRemove={() => onRemove(item.key)}
                onRetry={() => onRetry(item.key)}
                onAllow={onAllowSlackChannel ? () => onAllowSlackChannel(item.key) : undefined}
              />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
