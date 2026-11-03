import './speech.css';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Command } from './commands.ts';
import type { Notice } from './speech-machine.ts';
import type { SpeechScreenModel } from './use-speech-island.ts';

const NOTICES: Record<Notice, string> = {
  missed: 'Didn’t catch that.',
  mic_denied: 'Spark can’t use the microphone.',
  model_missing: 'Voice is still getting its speech model.',
  bad_model: 'The speech model didn’t check out.',
  busy: 'Spark is already listening.',
  no_input_device: 'No microphone is connected.',
  file_input_off: 'File input is only for tests.',
  invalid: 'Voice is off.',
  failed: 'Voice stopped. Press again to retry.',
};

function heading(command: Command, count: number): string {
  switch (command.intent) {
    case 'start_chat':
      return count === 0 ? `No project called “${command.project.heard}”.` : 'Which project?';
    case 'reply':
      return count === 0 ? `No chat called “${command.chat.heard}”.` : 'Which chat?';
    case 'open':
      return count === 0 ? `Nothing called “${command.target.heard}”.` : 'Found';
    default:
      return '';
  }
}

const LIVE_CHARS = 140;

export function liveWords(text: string): string {
  const words = text.trim();
  if (words.length <= LIVE_CHARS) return words;
  const tail = words.slice(-LIVE_CHARS);
  return `…${tail.slice(tail.indexOf(' ') + 1)}`;
}

function Listening({ screen }: { screen: SpeechScreenModel }) {
  const listen = screen.state.listen!;
  const working = listen.phase === 'working';
  const confirming = listen.purpose === 'confirm';
  const words = liveWords(listen.partial);
  return (
    <div className="speech-screen">
      <p className="speech-state" aria-live="polite">
        {working
          ? 'Working it out…'
          : confirming
            ? 'Say “yes” or “no”… Esc to cancel'
            : 'Listening… Esc to cancel'}
      </p>
      {words && (
        <p className="speech-live" aria-hidden="true" data-testid="speech-live">
          {words}
        </p>
      )}
      {!working && (
        <div className="speech-meter" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0.04, listen.level)})` }} />
        </div>
      )}
      {!working && listen.id && (
        <div className="speech-actions">
          <button type="button" className="isl-btn" onClick={screen.onStop}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function Choices({ screen }: { screen: SpeechScreenModel }) {
  const listRef = useRef<HTMLUListElement>(null);
  const { choices, selected } = screen;
  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${selected}"]`)?.focus();
  }, [selected, choices.length]);
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      screen.onSelect((selected + step + choices.length) % choices.length);
    }
  };
  return (
    <ul
      ref={listRef}
      className="speech-list"
      role="listbox"
      aria-label="Matches"
      onKeyDown={onKeyDown}
    >
      {choices.map((choice, index) => (
        <li key={`${choice.label}-${index}`} role="presentation">
          <button
            type="button"
            role="option"
            className="speech-choice"
            data-index={index}
            aria-selected={index === selected}
            tabIndex={index === selected ? 0 : -1}
            onFocus={() => screen.onSelect(index)}
            onClick={() => screen.onConfirm(index)}
          >
            <span>{choice.label}</span>
            {choice.detail && <small>{choice.detail}</small>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SpeechScreen({ screen }: { screen: SpeechScreenModel }) {
  const { state, shown } = screen;
  if (state.listen) return <Listening screen={screen} />;
  if (!shown) {
    const notice = state.notice ?? 'failed';
    return (
      <div className="speech-screen" role="status">
        <p className="speech-state">{NOTICES[notice]}</p>
        {notice === 'mic_denied' && (
          <div className="speech-actions">
            <button type="button" className="isl-btn" onClick={screen.onOpenSettings}>
              Open Microphone settings
            </button>
          </div>
        )}
        {notice === 'missed' && (
          <p className="speech-heard">Press the Voice shortcut to try again.</p>
        )}
      </div>
    );
  }
  return (
    <div className="speech-screen">
      <p className="speech-heard">“{shown.transcript}”</p>
      <p className="speech-state" aria-live="polite">
        {heading(shown.command, screen.choices.length)}
      </p>
      {screen.choices.length > 0 && <Choices screen={screen} />}
      <p className="speech-heard">
        {screen.choices.length > 0
          ? 'Enter or a click to open. Press the Voice shortcut and say “yes” to confirm.'
          : 'Esc to close.'}
      </p>
    </div>
  );
}
