import '../chat/composer.css';
import './outpost-composer.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { XIcon } from '../ui/icons.tsx';
import { HandlePicker, handleOptionId } from './HandlePicker.tsx';
import {
  composerTarget,
  handleQuery,
  matchingHandles,
  withHandle,
  type Answering,
  type ComposerTarget,
} from './composer-target.ts';
import type { MemberView } from './member-view.ts';

interface OutpostComposerProps {
  members: readonly MemberView[];
  answering: Answering | null;
  paused: boolean;
  allowAll?: boolean;
  onCancelAnswer: () => void;
  onSend: (target: ComposerTarget, text: string) => Promise<unknown>;
}

const MAX_ROWS = 8;

function shownHint(target: ComposerTarget, paused: boolean, allowAll: boolean): string {
  if (target.action === 'all' && !allowAll) return 'Address one chat at a time, for example @fe.';
  if (target.action === 'request' && paused) {
    return `Paused. @${target.to} gets this when you resume.`;
  }
  return target.hint;
}

export function OutpostComposer({
  members,
  answering,
  paused,
  allowAll = false,
  onCancelAnswer,
  onSend,
}: OutpostComposerProps) {
  const listId = useId();
  const hintId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const handles = members.map((member) => member.handle);
  const target = composerTarget(text, handles, answering);
  const options = answering || dismissed ? [] : matchingHandles(handleQuery(text), members);
  const picking = options.length > 0;
  const current = Math.min(active, options.length - 1);
  const sendable = target.ready && (target.action !== 'all' || allowAll);
  const answeringId = answering?.postId ?? null;

  useEffect(() => {
    if (answeringId) textareaRef.current?.focus();
  }, [answeringId]);

  const change = (next: string) => {
    setText(next);
    setActive(0);
    setDismissed(false);
  };

  const pick = (member: MemberView) => {
    change(withHandle(member.handle));
    textareaRef.current?.focus();
  };

  const send = async () => {
    if (!sendable) return;
    const sent = text;
    setText('');
    setProblem(null);
    try {
      await onSend(target, sent);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be sent.');
      setText((typed) => (typed === '' ? sent : typed));
    }
  };

  const onPickerKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!picking) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + options.length) % options.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const member = options[current];
      if (member) pick(member);
      return true;
    }
    if (event.key === 'Escape') {
      setDismissed(true);
      return true;
    }
    return false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (onPickerKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && answering) {
      event.preventDefault();
      onCancelAnswer();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="composer-wrap">
      {problem && (
        <p className="composer-error" role="alert">
          {problem}
        </p>
      )}
      <div className="composer op-composer">
        {picking && (
          <HandlePicker
            listId={listId}
            options={options}
            active={current}
            onActive={setActive}
            onPick={pick}
          />
        )}
        {answering && (
          <div className="op-answering">
            <span>
              Answering <b>@{answering.handle}</b>
            </span>
            <button
              type="button"
              className="op-answering-stop"
              aria-label={`Stop answering @${answering.handle}`}
              onClick={onCancelAnswer}
            >
              <XIcon />
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          rows={Math.min(MAX_ROWS, Math.max(1, text.split('\n').length))}
          placeholder={
            answering ? `Answer @${answering.handle}` : 'Ask a chat with @, or post a note'
          }
          aria-label={answering ? `Answer @${answering.handle}` : 'Message the outpost'}
          aria-describedby={hintId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={picking}
          aria-controls={picking ? listId : undefined}
          aria-activedescendant={picking ? handleOptionId(listId, current) : undefined}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="comp-bar">
          <span id={hintId} className="hint shown op-hint">
            {shownHint(target, paused, allowAll)}
          </span>
          <button
            type="button"
            className="btn primary sm op-send"
            disabled={!sendable}
            onClick={() => void send()}
          >
            {target.label}
          </button>
        </div>
      </div>
    </div>
  );
}
