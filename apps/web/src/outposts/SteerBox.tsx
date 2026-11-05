import { useId, useState, type KeyboardEvent } from 'react';
import { ArrowUpIcon } from '../ui/icons.tsx';
import { ConfirmButton } from './ConfirmButton.tsx';

interface SteerBoxProps {
  handle: string;
  answering: boolean;
  canStop: boolean;
  sending: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

const MAX_ROWS = 6;

export function steerHint(handle: string, answering: boolean): string {
  return answering
    ? `Your answer goes to ${handle} as you, as if typed in its chat.`
    : `Sends to ${handle} as you, as if typed in its chat.`;
}

export function SteerBox({ handle, answering, canStop, sending, onSend, onStop }: SteerBoxProps) {
  const hintId = useId();
  const [text, setText] = useState('');
  const label = answering ? `Answer ${handle}` : `Message ${handle}`;
  const ready = text.trim() !== '' && !sending;

  const send = () => {
    if (!ready) return;
    onSend(text.trim());
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className={answering ? 'op-steer answering' : 'op-steer'}>
      <textarea
        value={text}
        rows={Math.min(MAX_ROWS, Math.max(1, text.split('\n').length))}
        placeholder={label}
        aria-label={label}
        aria-describedby={hintId}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="op-steer-bar">
        <span id={hintId} className="op-steer-hint">
          {steerHint(handle, answering)}
        </span>
        {canStop && <ConfirmButton label="Stop" what={`${handle}'s turn`} onConfirm={onStop} />}
        <button
          type="button"
          className="btn sm primary op-steer-send"
          aria-label={answering ? `Send the answer to ${handle}` : `Send to ${handle}`}
          disabled={!ready}
          onClick={send}
        >
          <ArrowUpIcon />
        </button>
      </div>
    </div>
  );
}
