import { memo } from 'react';
import './message-actions.css';
import { CheckIcon, CopyIcon } from '../../ui/icons.tsx';
import { useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { fullTime, messageTime } from './message-time.ts';
import { useMinute } from './use-minute.ts';

interface MessageActionsProps {
  text: string;
  createdAt: string;
  copyLabel: string;
  side: 'user' | 'assistant';
}

function RelativeTime({ iso }: { iso: string }) {
  const minute = useMinute();
  return (
    <time className="msg-time" dateTime={iso} title={fullTime(iso)}>
      {messageTime(iso, minute)}
    </time>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { state, copy } = useCopyFeedback();
  const copied = state === 'copied';

  return (
    <button
      type="button"
      className={copied ? 'icon-btn msg-act copied' : 'icon-btn msg-act'}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={() => copy(text)}
    >
      {copied ? <CheckIcon className="msg-act-ok" /> : <CopyIcon />}
    </button>
  );
}

export const MessageActions = memo(function MessageActions({
  text,
  createdAt,
  copyLabel,
  side,
}: MessageActionsProps) {
  return (
    <div className={`msg-actions ${side}`} role="group" aria-label="Message actions">
      <RelativeTime iso={createdAt} />
      <CopyButton text={text} label={copyLabel} />
    </div>
  );
});
