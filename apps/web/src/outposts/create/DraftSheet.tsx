import '../outposts.css';
import '../outpost-sheet.css';
import './outpost-create.css';
import './draft-sheet.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { OUTPOST_NAME_MAX, type FailedMember } from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';
import { OutpostFaces } from '../MemberFace.tsx';
import { hasUnsavedInput, listedChats, settled, type CreateDraft } from './create-draft.ts';
import { faceIds } from './create-labels.ts';
import { continueBlock, isFinished, nameProblem } from './create-problems.ts';
import { startSummary } from './create-request.ts';
import { DiscardBar } from './DiscardBar.tsx';
import { DraftChats } from './DraftChats.tsx';
import { sheetKeys, useReturnFocus } from './sheet-keys.ts';
import { StartResult } from './StartResult.tsx';
import { isLead, leadHandle } from './story-draft.ts';
import type { DraftChange } from './use-chat-actions.ts';
import type { CreateData } from './use-create-data.ts';

interface DraftSheetProps {
  initial: CreateDraft;
  draft: CreateDraft;
  data: CreateData;
  starting: boolean;
  failure: string | null;
  failed: readonly FailedMember[] | null;
  onChange: (change: DraftChange) => void;
  onStart: () => void;
  onOpenOutpost: () => void;
  onClose: () => void;
}

function chatCounts(draft: CreateDraft): string[] {
  const reused = listedChats(draft).filter(
    (chat) => chat.kind === 'existing' && !isLead(draft, chat),
  ).length;
  const fresh = startSummary(draft).newChats;
  return [
    ...(fresh > 0 || reused === 0 ? [countLabel(fresh, 'new chat')] : []),
    ...(reused > 0 ? [countLabel(reused, 'existing chat')] : []),
  ];
}

function sheetTitle(draft: CreateDraft): string {
  const summary = startSummary(draft);
  if (draft.into) return `Start ${countLabel(summary.chats, 'chat')} in ${draft.into.name}`;
  return `Start a new outpost with ${chatCounts(draft).join(' and ')}`;
}

function lede(draft: CreateDraft): string {
  const lead = leadHandle(draft);
  const by = lead === null ? 'Proposed by a chat.' : `Proposed by @${lead}.`;
  const whose =
    lead === null
      ? "First messages are sent as the proposing chat's, not yours."
      : `First messages are sent as @${lead}'s, not yours.`;
  return `${by} Nothing starts until you start it. ${whose}`;
}

function footNote(draft: CreateDraft): string {
  const chats = chatCounts(draft).join(' · ');
  return draft.into ? `${chats} · in ${draft.into.name}` : chats;
}

export function DraftSheet(props: DraftSheetProps) {
  const { initial, draft, data, starting, failed, onChange } = props;
  useReturnFocus();
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const sentRef = useRef(false);
  const [discarding, setDiscarding] = useState(false);
  const [nameTried, setNameTried] = useState(false);
  const into = draft.into ?? null;
  const name = into ? null : nameProblem(draft.name);
  const block = continueBlock(draft, data.chats) ?? (nameTried ? name : null);
  const finished = (chat: CreateDraft['chats'][number], current: CreateDraft) =>
    isFinished(chat, current, data.chats);
  const openFinished = draft.chats.some((chat) => chat.open && finished(chat, draft));
  const hint = block ?? footNote(draft);
  const firstFocus = useRef(name === null ? primaryRef : nameRef);

  useEffect(() => {
    firstFocus.current.current?.focus();
  }, []);

  const send = () => {
    sentRef.current = true;
    props.onStart();
  };

  const start = () => {
    if (starting || (sentRef.current && !failed && props.failure === null)) return;
    if (failed) {
      send();
      return;
    }
    setNameTried(true);
    if (name !== null) {
      nameRef.current?.focus();
      return;
    }
    if (continueBlock(draft, data.chats) === null) send();
  };

  const settleOpen = () => {
    onChange((current) => settled(current, (chat) => finished(chat, current)));
    primaryRef.current?.focus();
  };

  const requestClose = () => {
    if (starting) return;
    if (failed) props.onOpenOutpost();
    else if (hasUnsavedInput(initial, draft) && !discarding) setDiscarding(true);
    else props.onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) =>
    sheetKeys({
      discarding,
      onKeep: () => setDiscarding(false),
      onClose: requestClose,
      onPrimary: start,
      onEnterInField: () => (openFinished ? settleOpen() : start()),
    })(event);

  const primaryLabel = into
    ? `Start ${countLabel(startSummary(draft).chats, 'chat')}`
    : 'Start outpost';

  return (
    <div
      className="op-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        className="op-sheet op-create op-draft-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}title`}
        aria-describedby={`${ids}lede`}
        onKeyDown={onKeyDown}
      >
        <header className="op-draft-head">
          <h2 id={`${ids}title`}>{sheetTitle(draft)}</h2>
          <p id={`${ids}lede`}>{lede(draft)}</p>
        </header>
        <div className="op-sheet-body">
          <OutpostFaces listed={faceIds(listedChats(draft))}>
            {failed && <StartResult name={draft.name.trim()} failed={failed} />}
            {!failed && !into && (
              <label className="field op-draft-name">
                <span>Outpost name</span>
                <input
                  ref={nameRef}
                  className="inp"
                  value={draft.name}
                  maxLength={OUTPOST_NAME_MAX}
                  aria-invalid={nameTried && name !== null}
                  onChange={(event) =>
                    onChange((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
            )}
            {!failed && (
              <DraftChats
                draft={draft}
                data={data}
                onChange={onChange}
                onSettled={() => primaryRef.current?.focus()}
              />
            )}
          </OutpostFaces>
        </div>
        {props.failure && (
          <p className="op-sheet-failure" role="alert">
            {props.failure}
          </p>
        )}
        {discarding ? (
          <DiscardBar
            question={into ? 'Discard these chats?' : 'Discard this outpost?'}
            onKeep={() => setDiscarding(false)}
            onDiscard={props.onClose}
          />
        ) : (
          <footer className="op-sheet-foot op-create-foot">
            <span id={`${ids}hint`} className={block ? 'op-foot-hint bad' : 'op-foot-hint'}>
              {failed ? null : hint}
            </span>
            {failed ? (
              <button type="button" className="btn sm ghost" onClick={props.onOpenOutpost}>
                Open outpost
              </button>
            ) : (
              <button
                type="button"
                className="btn sm ghost"
                disabled={starting}
                onClick={requestClose}
              >
                Cancel
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              className="btn sm primary"
              disabled={starting || (!failed && block !== null)}
              aria-describedby={block ? `${ids}hint` : undefined}
              onClick={start}
            >
              {starting ? 'Starting…' : failed ? 'Try again' : primaryLabel}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
