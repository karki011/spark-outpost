import '../../chat/composer.css';
import { useId, useRef, useState } from 'react';
import { TERMINAL_MESSAGE_MAX_LENGTH, type BusyEnterAction } from '@spark-outpost/contracts';
import { ComposerShell, composerRows } from '../../chat/composer/ComposerShell.tsx';
import { SendButton } from '../../chat/composer/SendButton.tsx';
import { enterAction } from '../../chat/queue/send-choice.ts';
import { SecretWarning } from '../../ui/SecretWarning.tsx';
import { useSecretGuard } from '../../ui/use-secret-guard.ts';

const LABEL = 'Message the agent';

export function RemoteTerminalComposer({
  blocked,
  working,
  preferred,
  error,
  onSend,
  onStop,
}: {
  blocked: string | null;
  working: boolean;
  preferred: BusyEnterAction;
  error: string | null;
  onSend: (text: string, now: boolean) => Promise<boolean>;
  onStop: () => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const secrets = useSecretGuard(text);
  const ready = text.trim().length > 0 && !sending && blocked === null;
  const send = async (now = false) => {
    if (!ready || secrets.blocks(text)) return;
    setSending(true);
    try {
      if (await onSend(text, now)) setText('');
    } finally {
      setSending(false);
    }
  };
  return (
    <ComposerShell
      error={error}
      warning={
        <SecretWarning
          guard={secrets}
          input={input}
          onText={setText}
          onSendAnyway={() => void send()}
        />
      }
      context={null}
      bar={
        <SendButton
          busy={working}
          label="Send"
          disabled={!ready}
          onSend={() => void send()}
          onStop={() => void onStop()}
          busySend={{ preferred, onChoice: (action) => void send(action === 'now') }}
        />
      }
    >
      {blocked && (
        <p className="composer-notice" role="status">
          {blocked}
        </p>
      )}
      <label className="sr-only" htmlFor={inputId}>
        {LABEL}
      </label>
      <textarea
        ref={input}
        id={inputId}
        value={text}
        rows={composerRows(text)}
        placeholder={LABEL}
        maxLength={TERMINAL_MESSAGE_MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void send(working && enterAction(event, preferred) === 'now');
        }}
      />
    </ComposerShell>
  );
}
