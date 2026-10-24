import '../outposts.css';
import '../outpost-sheet.css';
import './outpost-create.css';
import { useEffect, useId, useRef, useState } from 'react';
import type { FailedMember } from '@spark-outpost/contracts';
import { XIcon } from '../../ui/icons.tsx';
import { OutpostFaces } from '../MemberFace.tsx';
import {
  hasUnsavedInput,
  listedChats,
  settled,
  type ChatDraft,
  type CreateDraft,
} from './create-draft.ts';
import { faceIds } from './create-labels.ts';
import { continueBlock, isFinished, nameProblem } from './create-problems.ts';
import { sheetKeys, useReturnFocus } from './sheet-keys.ts';
import { SheetFooter } from './SheetFooter.tsx';
import { StartResult } from './StartResult.tsx';
import { StepChats } from './StepChats.tsx';
import type { DraftChange } from './use-chat-actions.ts';
import { StepName } from './StepName.tsx';
import { Stepper } from './Stepper.tsx';
import { StepReview } from './StepReview.tsx';
import type { CreateData } from './use-create-data.ts';

interface CreateSheetProps {
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

const NAME = 0;
const CHATS = 1;
const REVIEW = 2;

export function CreateSheet(props: CreateSheetProps) {
  const { initial, draft, data, starting, failed, onChange } = props;
  useReturnFocus();
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(NAME);
  const [nameTried, setNameTried] = useState(false);
  const [chatsFocus, setChatsFocus] = useState(0);
  const [discarding, setDiscarding] = useState(false);
  const block = continueBlock(draft, data.chats);
  const finished = (chat: ChatDraft, current: CreateDraft) => isFinished(chat, current, data.chats);
  const openFinished = draft.chats.some((chat) => chat.open && finished(chat, draft));

  useEffect(() => {
    if (step === NAME) nameRef.current?.focus();
    if (step === REVIEW) primaryRef.current?.focus();
  }, [step]);

  const goTo = (next: number) => {
    setStep(next);
    if (next === CHATS) setChatsFocus((count) => count + 1);
  };

  const leaveName = () => {
    setNameTried(true);
    if (nameProblem(draft.name) === null) goTo(CHATS);
  };

  const settle = () => onChange((current) => settled(current, (chat) => finished(chat, current)));

  const leaveChats = () => {
    if (block !== null) return;
    settle();
    goTo(REVIEW);
  };

  const primary = () => {
    if (starting) return;
    if (failed) props.onStart();
    else if (step === NAME) leaveName();
    else if (step === CHATS) leaveChats();
    else props.onStart();
  };

  const enter = () => {
    if (step !== CHATS || !openFinished) {
      primary();
      return;
    }
    settle();
    setChatsFocus((count) => count + 1);
  };

  const requestClose = () => {
    if (starting) return;
    if (failed) props.onOpenOutpost();
    else if (hasUnsavedInput(initial, draft) && !discarding) setDiscarding(true);
    else props.onClose();
  };

  const onKeyDown = sheetKeys({
    discarding,
    onKeep: () => setDiscarding(false),
    onClose: requestClose,
    onPrimary: primary,
    onEnterInField: enter,
  });

  return (
    <div
      className="op-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        className="op-sheet op-create"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}title`}
        onKeyDown={onKeyDown}
      >
        <header className="op-sheet-head">
          <h2 id={`${ids}title`}>New outpost</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={requestClose}>
            <XIcon />
          </button>
        </header>
        <Stepper current={failed ? REVIEW + 1 : step} />
        <div className="op-sheet-body">
          <OutpostFaces listed={faceIds(listedChats(draft))}>
            {failed && <StartResult name={draft.name.trim()} failed={failed} />}
            {!failed && step === NAME && (
              <StepName
                inputRef={nameRef}
                name={draft.name}
                problem={nameTried ? nameProblem(draft.name) : null}
                onName={(name) => onChange((current) => ({ ...current, name }))}
              />
            )}
            <StepChats
              draft={draft}
              data={data}
              hidden={failed !== null || step !== CHATS}
              focusSignal={chatsFocus}
              onChange={onChange}
            />
            {!failed && step === REVIEW && (
              <StepReview
                draft={draft}
                data={data}
                onEditName={() => goTo(NAME)}
                onEditChats={() => goTo(CHATS)}
              />
            )}
          </OutpostFaces>
        </div>
        {props.failure && (
          <p className="op-sheet-failure" role="alert">
            {props.failure}
          </p>
        )}
        <SheetFooter
          step={failed ? 'result' : step === NAME ? 'name' : step === CHATS ? 'chats' : 'review'}
          primaryRef={primaryRef}
          starting={starting}
          block={block}
          addsOpenChat={openFinished}
          discarding={discarding}
          onBack={() => (step === NAME ? requestClose() : goTo(step - 1))}
          onPrimary={primary}
          onOpenOutpost={props.onOpenOutpost}
          onKeep={() => setDiscarding(false)}
          onDiscard={props.onClose}
        />
      </div>
    </div>
  );
}
