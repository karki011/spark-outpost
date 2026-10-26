import '../chat/composer.css';
import './outpost-composer.css';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { composerRows } from '../chat/composer/ComposerShell.tsx';
import { FormatToggle } from '../chat/composer/markdown/FormatToggle.tsx';
import { MarkdownInput } from '../chat/composer/markdown/MarkdownInput.tsx';
import { codeBlockEnter } from '../chat/composer/markdown/md-keys.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { XIcon } from '../ui/icons.tsx';
import { AsksLine } from './AsksLine.tsx';
import { HandlePicker, handleOptionId } from './HandlePicker.tsx';
import {
  NOBODY_HINT,
  asked,
  composerTarget,
  type Answering,
  type ComposerTarget,
} from './composer-target.ts';
import type { MemberView } from './member-view.ts';
import { useHandlePicker } from './use-handle-picker.ts';

interface OutpostComposerProps {
  members: readonly MemberView[];
  leadConversationId?: string | null;
  answering: Answering | null;
  paused: boolean;
  fill?: ComposerFill | null;
  onCancelAnswer: () => void;
  onSend: (target: ComposerTarget, text: string, id: string) => Promise<unknown>;
}

export interface ComposerFill {
  id: number;
  text: string;
}

const MAX_ROWS = 8;
const NOTHING_TYPED = { text: '', caret: 0 };

export function OutpostComposer({
  members,
  leadConversationId = null,
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
  const [destinationId, setDestinationId] = useState('lead');
  const activeMembers = members.filter((member) => !member.archived);
  const lead =
    activeMembers.find((member) => member.conversationId === leadConversationId) ??
    activeMembers[0];
  const destination =
    destinationId === 'lead'
      ? lead
      : activeMembers.find((member) => member.conversationId === destinationId);
  const note = destinationId === 'note';
  const [skipped, setSkipped] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failedSend, setFailedSend] = useState<{
    text: string;
    target: ComposerTarget;
    deliver: () => Promise<unknown>;
  } | null>(null);
  const [filled, setFilled] = useState(fill?.id ?? null);
  const [formatting, setFormatting] = useState(false);
  const [noteReceipt, setNoteReceipt] = useState<{ text: string; pending: boolean } | null>(null);
  const handles = useMemo(
    () => members.filter((member) => !member.archived).map((member) => member.handle),
    [members],
  );
  const mentionable = useMemo(() => [...handles, 'all'], [handles]);
  const picker = useHandlePicker(typed, activeMembers, answering === null && !note);
  const fillId = fill?.id ?? null;
  if (fill && fill.id !== filled) {
    setFilled(fill.id);
    setDestinationId('lead');
    setNoteReceipt(null);
    setTyped({ text: fill.text, caret: fill.text.length });
    setSkipped([]);
    picker.close();
  }
  const { text } = typed;
  const target = composerTarget(text, handles, answering, skipped, destination ?? null, note);
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
    setNoteReceipt(null);
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

  const askAll = (body: string) => {
    setDestinationId('lead');
    const next = /^@all(?:\s|$)/i.test(body.trim()) ? body : `@all ${body}`;
    setSkipped([]);
    caretToPlace.current = next.length;
    change(next, next.length);
    textareaRef.current?.focus();
  };

  const deliver = async (request: NonNullable<typeof failedSend>) => {
    const receipt = request.target.action === 'note' ? { text: request.text, pending: true } : null;
    setSending(true);
    setNoteReceipt(receipt);
    setProblem(null);
    try {
      await request.deliver();
      setFailedSend(null);
      setNoteReceipt((now) => (now && now === receipt ? { ...now, pending: false } : now));
    } catch (error) {
      setNoteReceipt((now) => (now === receipt ? null : now));
      setProblem(error instanceof Error ? error.message : 'That could not be sent.');
      setFailedSend(request);
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (!target.ready || sending || failedSend) return;
    const sent = text;
    const id = crypto.randomUUID();
    setTyped(NOTHING_TYPED);
    setSkipped([]);
    await deliver({ text: sent, target, deliver: () => onSend(target, sent, id) });
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
      {noteReceipt && !answering && text === '' && (
        <div className="op-note-receipt">
          <span role="status">
            {noteReceipt.pending ? 'Saving note…' : 'Note saved · No agent was asked.'}
          </span>
          {!noteReceipt.pending && activeMembers.length > 0 && (
            <button type="button" className="btn ghost sm" onClick={() => askAll(noteReceipt.text)}>
              Ask all
            </button>
          )}
        </div>
      )}
      {problem && (
        <p className="composer-error" role="alert">
          {problem}
        </p>
      )}
      {failedSend && (
        <div className="op-note-receipt">
          <span>
            Unsent{' '}
            {failedSend.target.action === 'note'
              ? 'note'
              : `to @${failedSend.target.to.join(', @')}`}
            : {failedSend.text.slice(0, 120)}
          </span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={sending}
            onClick={() => void deliver(failedSend)}
          >
            Retry
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={sending}
            onClick={() => {
              setFailedSend(null);
              setProblem(null);
            }}
          >
            Discard unsent message
          </button>
        </div>
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
          mentionable={mentionable}
          value={text}
          rows={composerRows(text, MAX_ROWS)}
          placeholder={
            answering
              ? `Answer @${answering.handle}`
              : note
                ? 'Write a note'
                : 'Message your agent, @ to ask another'
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
          {!answering && (
            <div className="op-destination">
              <ChoicePicker
                label="Message destination"
                value={destinationId}
                showNote={false}
                placeholder="Agent unavailable"
                choices={[
                  { id: 'lead', label: lead ? `Lead · @${lead.handle}` : 'No agent available' },
                  ...activeMembers.map((member) => ({
                    id: member.conversationId,
                    label: `@${member.handle}`,
                  })),
                  { id: 'note', label: 'Post note', description: 'Save without asking an agent' },
                ]}
                onChange={(id) => {
                  setDestinationId(id);
                  setNoteReceipt(null);
                  picker.close();
                }}
              />
            </div>
          )}
          {target.action === 'request' && !target.hint && !target.toConversationId ? (
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
              {target.toConversationId
                ? paused
                  ? `Paused. @${target.to[0]} gets this when you resume.`
                  : `To @${target.to[0]}`
                : target.hint}
            </span>
          )}
          {target.hint === NOBODY_HINT && activeMembers.length > 0 && (
            <button type="button" className="btn ghost sm" onClick={() => askAll(text)}>
              Ask all
            </button>
          )}
          <button
            type="button"
            className="btn primary sm op-send"
            disabled={!target.ready || sending || failedSend !== null}
            onClick={() => void send()}
          >
            {target.label}
          </button>
        </div>
      </div>
    </div>
  );
}
