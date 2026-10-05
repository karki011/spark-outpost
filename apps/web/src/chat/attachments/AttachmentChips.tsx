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
import { pickLabel } from '../../browser/pick-files.ts';
import { PickChip } from './PickChip.tsx';
import type { PagePick, PendingAttachment } from './use-attachments.ts';
import { sharedChatView } from './shared-chat.ts';

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

interface ChipSlot {
  key: string;
  pick: PagePick | null;
  items: PendingAttachment[];
}

function chipSlots(items: readonly PendingAttachment[]): ChipSlot[] {
  const slots = new Map<string, ChipSlot>();
  for (const item of items) {
    const failed = items.some(
      (other) => other.pick?.id === item.pick?.id && other.status === 'error',
    );
    const pick = item.pick && !failed ? item.pick : null;
    const key = pick?.id ?? item.key;
    const slot = slots.get(key) ?? { key, pick, items: [] };
    slot.items.push(item);
    slots.set(key, slot);
  }
  return [...slots.values()];
}

function PendingPick({ slot, onRemove }: { slot: ChipSlot; onRemove: (key: string) => void }) {
  const uploading = slot.items.filter((item) => item.status === 'uploading');
  const text = slot.pick?.text ?? '';
  return (
    <PickChip
      label={pickLabel(text) ?? 'Selected on the page'}
      picture={slot.items.find((item) => item.kind === 'image')?.previewUrl ?? null}
      text={text}
      uploading={uploading.length > 0 ? Math.min(...uploading.map((item) => item.progress)) : null}
      onRemove={() => slot.items.forEach((item) => onRemove(item.key))}
    />
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
        {chipSlots(items).map((slot) => (
          <motion.div key={slot.key} className="chip-slot" {...chipMotion}>
            {slot.pick ? (
              <PendingPick slot={slot} onRemove={onRemove} />
            ) : (
              slot.items.map((item) =>
                item.kind === 'image' && item.status !== 'error' ? (
                  <ImageTile key={item.key} item={item} onRemove={() => onRemove(item.key)} />
                ) : item.source.type === 'chat' && item.status !== 'error' ? (
                  <ChatChip key={item.key} item={item} onRemove={() => onRemove(item.key)} />
                ) : (
                  <FileChip
                    key={item.key}
                    item={item}
                    onRemove={() => onRemove(item.key)}
                    onRetry={() => onRetry(item.key)}
                    onAllow={onAllowSlackChannel ? () => onAllowSlackChannel(item.key) : undefined}
                  />
                ),
              )
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
