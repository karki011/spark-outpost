import { useState, type KeyboardEvent } from 'react';
import { TERMINAL_MESSAGE_MAX_LENGTH } from '@spark-outpost/contracts';

export function RemoteTerminalComposer({
  blocked,
  working,
  onSend,
  onStop,
}: {
  blocked: string | null;
  working: boolean;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ready = text.trim().length > 0 && !sending && blocked === null;
  const send = async () => {
    if (!ready) return;
    setSending(true);
    try {
      if (await onSend(text)) setText('');
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };
  return (
    <form
      className="rt-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {blocked && <p className="rt-note">{blocked}</p>}
      <textarea
        aria-label="Message the agent"
        placeholder="Message the agent"
        rows={2}
        maxLength={TERMINAL_MESSAGE_MAX_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="rt-composer-actions">
        {working && (
          <button type="button" className="btn line" onClick={() => void onStop()}>
            Stop
          </button>
        )}
        <button type="submit" className="btn primary" disabled={!ready}>
          Send
        </button>
      </div>
    </form>
  );
}
