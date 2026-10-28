import './speech.css';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { terminalRemoteApi } from '../terminal/terminal-api.ts';
import { MicButton } from './MicButton.tsx';
import { useDictationDraft } from './use-dictation-draft.ts';

interface TerminalDictationProps {
  chatId: string;
  agentName: string;
}

export function TerminalDictation({ chatId, agentName }: TerminalDictationProps) {
  const [text, setText] = useState<string | null>(null);
  const voice = useDictationDraft(text ?? '', setText, chatId);
  const discard = () => {
    voice.dictation.cancel();
    setText(null);
  };
  const send = useMutation({
    mutationFn: (message: string) => terminalRemoteApi.message(chatId, message),
    onSuccess: () => setText(null),
  });
  return (
    <>
      <MicButton dictation={voice.dictation} />
      {(text !== null || voice.dictation.active) && (
        <form
          className="tdict"
          aria-label="Dictated message"
          onSubmit={(event) => {
            event.preventDefault();
            if (!voice.dictation.active && text?.trim()) send.mutate(text.trim());
          }}
        >
          <label className="sr-only" htmlFor={`tdict-${chatId}`}>
            Dictated message for {agentName}
          </label>
          <input
            id={`tdict-${chatId}`}
            value={voice.value}
            autoFocus
            onChange={(event) => voice.change(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') discard();
            }}
          />
          <button
            type="submit"
            className="btn primary sm"
            disabled={voice.dictation.active || !text?.trim() || send.isPending}
          >
            Send to {agentName}
          </button>
          <button type="button" className="btn ghost sm" onClick={discard}>
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
