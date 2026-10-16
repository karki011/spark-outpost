import './speech.css';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { terminalRemoteApi } from '../terminal/terminal-api.ts';
import { MicButton } from './MicButton.tsx';
import { joinDictation } from './use-dictation.ts';

interface TerminalDictationProps {
  chatId: string;
  agentName: string;
}

export function TerminalDictation({ chatId, agentName }: TerminalDictationProps) {
  const [text, setText] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (message: string) => terminalRemoteApi.message(chatId, message),
    onSuccess: () => setText(null),
  });
  return (
    <>
      <MicButton onText={(heard) => setText((now) => joinDictation(now ?? '', heard))} />
      {text !== null && (
        <form
          className="tdict"
          aria-label="Dictated message"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) send.mutate(text.trim());
          }}
        >
          <label className="sr-only" htmlFor={`tdict-${chatId}`}>
            Dictated message for {agentName}
          </label>
          <input
            id={`tdict-${chatId}`}
            value={text}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setText(null);
            }}
          />
          <button
            type="submit"
            className="btn primary sm"
            disabled={!text.trim() || send.isPending}
          >
            Send to {agentName}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setText(null)}>
            Discard
          </button>
          {send.isError && (
            <span className="tdict-error" role="alert">
              {send.error.message}
            </span>
          )}
        </form>
      )}
    </>
  );
}
