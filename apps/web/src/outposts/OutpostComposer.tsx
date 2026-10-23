import '../chat/composer.css';
import './outpost-composer.css';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FormatToggle } from '../chat/composer/markdown/FormatToggle.tsx';
import { MarkdownInput } from '../chat/composer/markdown/MarkdownInput.tsx';
import { codeBlockEnter } from '../chat/composer/markdown/md-keys.ts';
import { XIcon } from '../ui/icons.tsx';
import { AsksLine } from './AsksLine.tsx';
import { HandlePicker, handleOptionId } from './HandlePicker.tsx';
import { asked, composerTarget, type Answering, type ComposerTarget } from './composer-target.ts';
import type { MemberView } from './member-view.ts';
import { useHandlePicker } from './use-handle-picker.ts';

interface OutpostComposerProps {
  members: readonly MemberView[];
  answering: Answering | null;
  paused: boolean;
  fill?: ComposerFill | null;
  onCancelAnswer: () => void;
  onSend: (target: ComposerTarget, text: string) => Promise<unknown>;
}

export interface ComposerFill {
  id: number;
  text: string;
}

const MAX_ROWS = 8;
const NOTHING_TYPED = { text: '', caret: 0 };

export function OutpostComposer({
  members,
  answering,
  paused,
  fill = null,
  onCancelAnswer,
  onSend,
}: OutpostComposerProps) {
  const listId = useId();
  const hintId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const caretToPlace = useRef<number | null>(null);
  const [typed, setTyped] = useState(NOTHING_TYPED);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [filled, setFilled] = useState(fill?.id ?? null);
  const [formatting, setFormatting] = useState(false);
  const handles = members.map((member) => member.handle);
  const picker = useHandlePicker(typed, members, answering === null);
  const fillId = fill?.id ?? null;
  if (fill && fill.id !== filled) {
    setFilled(fill.id);
    setTyped({ text: fill.text, caret: fill.text.length });
    setSkipped([]);
    picker.close();
  }
  const { text } = typed;
  const target = composerTarget(text, handles, answering, skipped);
  const picking = picker.options.length > 0;
  const answeringId = answering?.postId ?? null;

  useEffect(() => {
    if (answeringId) textareaRef.current?.focus();
  }, [answeringId]);

  useEffect(() => {
    if (fillId !== null) textareaRef.current?.focus();
  }, [fillId]);

  useLayoutEffect(() => {
    const caret = caretToPlace.current;
    if (caret === null) return;
    caretToPlace.current = null;
    textareaRef.current?.setSelectionRange(caret, caret);
  }, [typed]);

  const change = (next: string, caret: number) => {
    setTyped({ text: next, caret });
    setSkipped((left) => left.filter((handle) => asked(next, handles, []).includes(handle)));
    picker.reset();
  };

  const pick = (member: MemberView) => {
    const next = picker.filled(member);
    if (!next) return;
    caretToPlace.current = next.caret;
    change(next.text, next.caret);
    textareaRef.current?.focus();
  };

  const send = async () => {
    if (!target.ready) return;
    const sent = text;
    setTyped(NOTHING_TYPED);
    setSkipped([]);
    setProblem(null);
    try {
      await onSend(target, sent);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be sent.');
      setTyped((now) => (now.text === '' ? { text: sent, caret: sent.length } : now));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const picked = picker.onKey(event);
    if (picked !== null) {
      event.preventDefault();
      if (picked !== 'handled') pick(picked);
      return;
    }
    if (event.key === 'Escape' && answering) {
      event.preventDefault();
      onCancelAnswer();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (codeBlockEnter(event, event.currentTarget) === 'newline') return;
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
            options={picker.options}
            active={picker.current}
            onActive={picker.setActive}
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
        <MarkdownInput
          ref={textareaRef}
          formatting={formatting}
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
          aria-activedescendant={picking ? handleOptionId(listId, picker.current) : undefined}
          onChange={(event) => change(event.target.value, event.target.selectionStart)}
          onSelect={(event) => {
            const caret = event.currentTarget.selectionStart;
            setTyped((now) => (now.caret === caret ? now : { ...now, caret }));
          }}
          onKeyDown={onKeyDown}
        />
        <div className="comp-bar">
          <FormatToggle open={formatting} onToggle={setFormatting} />
          {target.action === 'request' ? (
            <AsksLine
              id={hintId}
              handles={target.to}
              paused={paused}
              onSkip={(handle) => {
                setSkipped((left) => [...left, handle]);
                textareaRef.current?.focus();
              }}
            />
          ) : (
            <span id={hintId} className="hint shown op-hint">
              {target.hint}
            </span>
          )}
          <button
            type="button"
            className="btn primary sm op-send"
            disabled={!target.ready}
            onClick={() => void send()}
          >
            {target.label}
          </button>
        </div>
      </div>
    </div>
  );
}
