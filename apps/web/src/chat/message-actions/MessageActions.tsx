import './message-actions.css';
import { useEffect, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon } from '../../ui/icons.tsx';
import { fullTime, messageTime } from './message-time.ts';
import { useMinute } from './use-minute.ts';

const COPIED_MS = 1600;

interface MessageActionsProps {
  text: string;
  createdAt: string;
  copyLabel: string;
  side: 'user' | 'assistant';
  children?: ReactNode;
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timeout);
  }, [copied]);

  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <button
      type="button"
      className={copied ? 'icon-btn msg-act copied' : 'icon-btn msg-act'}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={copy}
    >
      {copied ? <CheckIcon className="msg-act-ok" /> : <CopyIcon />}
    </button>
  );
}

export function MessageActions({
  text,
  createdAt,
  copyLabel,
  side,
  children,
}: MessageActionsProps) {
  return (
    <div className={`msg-actions ${side}`} role="group" aria-label="Message actions">
      <RelativeTime iso={createdAt} />
      <CopyButton text={text} label={copyLabel} />
      {children}
    </div>
  );
}
