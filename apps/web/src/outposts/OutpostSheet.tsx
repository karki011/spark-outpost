import './outpost-sheet.css';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { OUTPOST_NAME_MAX, type ConversationSummary } from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { XIcon } from '../ui/icons.tsx';
import { chatPlace } from './member-view.ts';
import {
  chatChoices,
  sheetProblems,
  withHandleFor,
  withMember,
  withoutMember,
  type Problem,
  type SheetForm,
} from './sheet-draft.ts';

interface OutpostSheetProps {
  mode: 'create' | 'edit';
  initial: SheetForm;
  chats: readonly ConversationSummary[];
  projectNames: Readonly<Record<string, string>>;
  outpostId?: string | null;
  canManage?: boolean;
  onStart: (form: SheetForm) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NOTHING_PICKED = '';

function problemFor(
  problems: readonly Problem[],
  field: Problem['field'],
  conversationId: string | null,
): string | null {
  return (
    problems.find((problem) => problem.field === field && problem.conversationId === conversationId)
      ?.message ?? null
  );
}

export function OutpostSheet({
  mode,
  initial,
  chats,
  projectNames,
  outpostId = null,
  canManage = true,
  onStart,
  onDelete,
  onClose,
}: OutpostSheetProps) {
  const ids = useId();
  const panelRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const problems = attempted ? sheetProblems(form, chats, outpostId) : [];
  const nameProblem = problemFor(problems, 'name', null);
  const listProblem = problemFor(problems, 'members', null);
  const choices = chatChoices(form, chats, outpostId).map(({ chat, unavailableReason }) => ({
    id: chat.id,
    label: chat.title,
    description: chatPlace(chat, projectNames),
    unavailableReason,
  }));

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setAttempted(true);
    if (sheetProblems(form, chats, outpostId).length > 0) {
      requestAnimationFrame(() =>
        panelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    void run(() => onStart({ ...form, name: form.name.trim() }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !busy) {
      event.stopPropagation();
      onClose();
      return;
    }
    const panel = event.currentTarget;
    wrapTabFocus(event, () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]);
  };

  const addChat = (conversationId: string) => {
    const chat = chats.find((candidate) => candidate.id === conversationId);
    if (chat) setForm((current) => withMember(current, chat, projectNames));
  };

  return (
    <div
      className="op-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        ref={panelRef}
        className="op-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}title`}
        aria-describedby={`${ids}lede`}
        noValidate
        onSubmit={submit}
        onKeyDown={onKeyDown}
      >
        <header className="op-sheet-head">
          <h2 id={`${ids}title`}>{mode === 'create' ? 'New outpost' : 'Edit outpost'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </header>
        <p id={`${ids}lede`} className="op-sheet-lede">
          A shared room where chats ask each other for work. Each chat keeps its own project, agent,
          mode and branch.
        </p>
        <div className="op-sheet-body">
          <label className="field">
            <span>Name</span>
            <input
              ref={nameRef}
              className="inp"
              value={form.name}
              maxLength={OUTPOST_NAME_MAX}
              aria-invalid={nameProblem !== null}
              aria-describedby={nameProblem ? `${ids}name` : undefined}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            {nameProblem && (
              <small id={`${ids}name`} className="op-problem">
                {nameProblem}
              </small>
            )}
          </label>
          {!canManage && (
            <p className="op-sheet-empty">
              Chats and handles are changed on your Mac. Deleting the outpost happens there too.
            </p>
          )}
          {canManage && (
            <div className="field">
              <span>
                Chats
                <small>
                  Each one gets a short handle the others use to address it. You can rename it
                  later. A new chat can be added after its first message.
                </small>
              </span>
              {form.members.length === 0 ? (
                <p className="op-sheet-empty">No chats yet. Add one below, or add them later.</p>
              ) : (
                <ul className="op-sheet-members">
                  {form.members.map((member) => {
                    const chat = chats.find((candidate) => candidate.id === member.conversationId);
                    const title = chat?.title ?? 'Deleted chat';
                    const problem =
                      problemFor(problems, 'handle', member.conversationId) ??
                      problemFor(problems, 'members', member.conversationId);
                    const problemId = `${ids}p${member.conversationId}`;
                    return (
                      <li key={member.conversationId}>
                        <span className="op-handle-field">
                          <span aria-hidden="true">@</span>
                          <input
                            className="inp"
                            value={member.handle}
                            aria-label={`Handle for ${title}`}
                            aria-invalid={problem !== null}
                            aria-describedby={problem ? problemId : undefined}
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            onChange={(event) =>
                              setForm(
                                withHandleFor(form, member.conversationId, event.target.value),
                              )
                            }
                          />
                        </span>
                        <span className="op-sheet-chat">
                          <b>{title}</b>
                          <small>{chatPlace(chat, projectNames)}</small>
                        </span>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remove ${title}`}
                          onClick={() => setForm(withoutMember(form, member.conversationId))}
                        >
                          <XIcon />
                        </button>
                        {problem && (
                          <small id={problemId} className="op-problem">
                            {problem}
                          </small>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {listProblem && <small className="op-problem">{listProblem}</small>}
              <div className="op-sheet-add">
                {choices.length > 0 ? (
                  <ChoicePicker
                    label="Add a chat"
                    placeholder="Add a chat"
                    choices={choices}
                    value={NOTHING_PICKED}
                    onChange={addChat}
                  />
                ) : (
                  <small className="op-sheet-note">No other chats to add.</small>
                )}
              </div>
            </div>
          )}
          {onDelete && canManage && (
            <div className="op-sheet-danger">
              <HoldToConfirm
                label="Hold to delete outpost"
                hint="Deletes this outpost and its thread. The chats stay."
                holdingHint="Keep holding to delete."
                releasedHint="Released early. Nothing was deleted."
                disabled={busy}
                onConfirm={() => void run(onDelete)}
              />
            </div>
          )}
        </div>
        {failure && (
          <p className="op-sheet-failure" role="alert">
            {failure}
          </p>
        )}
        <footer className="op-sheet-foot">
          <button type="button" className="btn sm ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn sm primary" disabled={busy}>
            {mode === 'create' ? 'Create outpost' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  );
}
